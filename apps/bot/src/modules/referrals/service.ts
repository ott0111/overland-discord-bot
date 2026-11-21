import type { Guild } from "discord.js";
import { prisma, audit } from "../../lib/db.js";
import { awardPoints } from "../../lib/points.js";
import { getPointValues } from "../../lib/config.js";
import { detectSelfReferral, detectReferralBurst } from "../../lib/antifraud.js";
import { enqueue } from "../../lib/queue.js";
import { checkAndGrant } from "../achievements/service.js";
import { logger } from "../../lib/logger.js";

/**
 * Record a join against an invite code. Self-referrals are rejected,
 * repeat joins return the existing record (no duplicate reward), and a
 * burst of joins from one referrer in an hour is flagged suspicious for
 * staff review instead of silently paying out.
 */
export async function recordJoin(referrerDiscordId: string, referredDiscordId: string, inviteCode: string) {
  if (detectSelfReferral(referrerDiscordId, referredDiscordId)) throw new Error("Self-referrals are not allowed");
  const referrerUser = await prisma.user.findUnique({ where: { discordId: referrerDiscordId } });
  const referredUser = await prisma.user.findUnique({ where: { discordId: referredDiscordId } });
  if (!referrerUser || !referredUser) return null;
  const referrer = await prisma.discordMember.findUnique({ where: { userId: referrerUser.id } });
  const referred = await prisma.discordMember.findUnique({ where: { userId: referredUser.id } });
  if (!referrer || !referred) return null;
  const existing = await prisma.referral.findUnique({ where: { referrerId_referredId: { referrerId: referrer.id, referredId: referred.id } } });
  if (existing) return existing;
  const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const joinsInHour = await prisma.referral.count({ where: { referrerId: referrer.id, createdAt: { gte: oneHourAgo } } });
  const suspicious = detectReferralBurst(joinsInHour);
  const referral = await prisma.referral.create({ data: { referrerId: referrer.id, referredId: referred.id, inviteCode, suspicious } });
  if (suspicious) {
    await audit(null, "referrals.burst_flagged", "Referral", referral.id, { referrerId: referrer.id, joinsInHour });
  }
  await enqueue("referral-retention", { referralId: referral.id }, `retention-${referral.id}`, 7 * 24 * 60 * 60 * 1000);
  return referral;
}

/**
 * Verify a referral once the referred member completes verification.
 * Awards the configured verified-referral points (default 10) with the
 * idempotency key `referral-<id>`. Already verified referrals are a no-op.
 */
export async function verifyReferral(referralId: string) {
  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!referral || referral.verified) return referral;
  if (referral.suspicious) throw new Error("Referral is flagged suspicious and needs staff review first");
  const values = await getPointValues();
  const amount = (values.referral as unknown as Record<string, number>).verifiedReferral ?? 10;
  await awardPoints({
    memberId: referral.referrerId,
    currency: "OVERPOINTS",
    category: "referral",
    amount,
    source: "REFERRAL",
    reason: "Verified referral",
    idempotencyKey: `referral-${referralId}`,
  });
  await prisma.referral.update({ where: { id: referralId }, data: { verified: true, verifiedAt: new Date() } });
  const retentionDueAt = referral.createdAt.getTime() + 7 * 24 * 60 * 60 * 1000;
  await enqueue(
    "referral-retention",
    { referralId },
    "retention-verified-" + referralId,
    Math.max(0, retentionDueAt - Date.now() + 1000),
  );
  try {
    await checkAndGrant(referral.referrerId);
  } catch (err) {
    logger.warn({ err }, "Achievement check after referral verification failed");
  }
  return prisma.referral.findUnique({ where: { id: referralId } });
}

/**
 * Seven-day retention check. Awards the configured bonus (default 10)
 * when the referred member is still present and verified at least seven
 * days after joining. Idempotent on `retention-<referralId>`.
 */
export async function checkRetention7d(referralId: string, guild?: Guild) {
  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!referral || referral.retained7d || !referral.verified) return referral;
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  if (referral.createdAt > sevenDaysAgo) return referral;
  if (!guild) return referral;
  const referred = await prisma.discordMember.findUnique({ where: { id: referral.referredId }, include: { user: true } });
  if (!referred) return referral;
  const stillPresent = await guild.members.fetch(referred.user.discordId).then(() => true).catch(() => false);
  if (!stillPresent) return referral;
  const values = await getPointValues();
  const amount = (values.referral as unknown as Record<string, number>).sevenDayActive ?? 10;
  await awardPoints({
    memberId: referral.referrerId,
    currency: "OVERPOINTS",
    category: "referral",
    amount,
    source: "REFERRAL_RETENTION",
    reason: "Referral active for seven days",
    idempotencyKey: `retention-${referralId}`,
  });
  await prisma.referral.update({ where: { id: referralId }, data: { retained7d: true } });
  return prisma.referral.findUnique({ where: { id: referralId } });
}

/**
 * Comrade conversion check. Awards the configured bonus (default 5) when
 * the referred member now holds the Comrade role. Idempotent on
 * `referral-comrade-<referralId>`.
 */
export async function checkComradeConversion(referralId: string) {
  const referral = await prisma.referral.findUnique({ where: { id: referralId } });
  if (!referral || referral.becameComrade || !referral.verified) return referral;
  const comrade = await prisma.role.findUnique({ where: { name: "Comrade" } });
  if (!comrade) return referral;
  const hasComrade = await prisma.memberRole.findUnique({
    where: { memberId_roleId: { memberId: referral.referredId, roleId: comrade.id } },
  });
  if (!hasComrade) return referral;
  const values = await getPointValues();
  const amount = (values.referral as unknown as Record<string, number>).comradeBonus ?? 5;
  await awardPoints({
    memberId: referral.referrerId,
    currency: "OVERPOINTS",
    category: "referral",
    amount,
    source: "REFERRAL_COMRADE",
    reason: "Referral became Comrade",
    idempotencyKey: `referral-comrade-${referralId}`,
  });
  await prisma.referral.update({ where: { id: referralId }, data: { becameComrade: true } });
  return prisma.referral.findUnique({ where: { id: referralId } });
}

/** Referral stats for one member (used by /referrals). */
export async function getReferralStats(memberId: string) {
  const all = await prisma.referral.findMany({ where: { referrerId: memberId } });
  return {
    total: all.length,
    verified: all.filter((r: any) => r.verified).length,
    retained7d: all.filter((r: any) => r.retained7d).length,
    becameComrade: all.filter((r: any) => r.becameComrade).length,
    suspicious: all.filter((r: any) => r.suspicious).length,
    referrals: all,
  };
}

/** Referrals given by one member, newest first. */
export async function listReferrals(memberId: string, take = 50) {
  return prisma.referral.findMany({
    where: { referrerId: memberId },
    orderBy: { createdAt: "desc" },
    take,
    include: { referred: { include: { user: true } } },
  });
}

/** Top referrers by verified referrals, for the referral leaderboard. */
export async function referralLeaderboard(take = 10) {
  const rows = await prisma.referral.groupBy({
    by: ["referrerId"],
    where: { verified: true },
    _count: { _all: true },
    orderBy: { _count: { referrerId: "desc" } },
    take,
  });
  const members = await prisma.discordMember.findMany({
    where: { id: { in: rows.map((r: any) => r.referrerId) } },
    include: { user: true },
  });
  const byId = new Map(members.map((m: { id: string; user: { username: string } }) => [m.id, m.user.username]));
  return rows.map((r: any, idx: number) => ({ rank: idx + 1, memberId: r.referrerId, username: byId.get(r.referrerId) ?? "Unknown", verified: r._count._all }));
}
