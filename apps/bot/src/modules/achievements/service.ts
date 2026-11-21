import { prisma, audit } from "../../lib/db.js";
import { awardPoints, type TxClient } from "../../lib/points.js";
import { hasPermission } from "../../lib/permissions.js";
import { logger } from "../../lib/logger.js";

export const ACHIEVEMENT_KEYS = [
  "first-verification",
  "first-contribution",
  "first-referral",
  "first-social",
  "streak-7",
  "streak-30",
] as const;
export type AchievementKey = (typeof ACHIEVEMENT_KEYS)[number];

/**
 * Award the points attached to an achievement inside an open transaction.
 * Uses the same idempotency-key scheme as awardPoints so a retried grant
 * can never pay the same achievement twice.
 */
async function awardAchievementPoints(tx: TxClient, memberId: string, key: string, overpoints: number, overcredits: number) {
  if (overpoints > 0) {
    await awardPoints(
      {
        memberId,
        currency: "OVERPOINTS",
        category: "achievement",
        amount: overpoints,
        source: "ACHIEVEMENT",
        reason: `Achievement unlocked: ${key}`,
        idempotencyKey: `achievement-${memberId}-${key}-op`,
      },
      tx,
    );
  }
  if (overcredits > 0) {
    await awardPoints(
      {
        memberId,
        currency: "OVERCREDITS",
        category: "achievement",
        amount: overcredits,
        source: "ACHIEVEMENT",
        reason: `Achievement unlocked: ${key}`,
        idempotencyKey: `achievement-${memberId}-${key}-oc`,
      },
      tx,
    );
  }
}

/**
 * Grant an achievement atomically: the MemberAchievement row and both
 * point awards share one transaction. If the member already holds the
 * achievement the call is a no-op returning { duplicate: true }.
 */
export async function grantAchievement(memberId: string, key: string, actorId?: string | null) {
  const result = await prisma.$transaction(async (tx: any) => {
    const achievement = await tx.achievement.findUnique({ where: { key } });
    if (!achievement || !achievement.active) throw new Error(`Achievement not found or inactive: ${key}`);
    const existing = await tx.memberAchievement.findUnique({
      where: { memberId_achievementId: { memberId, achievementId: achievement.id } },
    });
    if (existing) return { duplicate: true, achievement, memberAchievement: existing };
    const memberAchievement = await tx.memberAchievement.create({
      data: { memberId, achievementId: achievement.id },
    });
    await awardAchievementPoints(
      tx as unknown as TxClient,
      memberId,
      key,
      achievement.overpointsReward,
      achievement.overcreditsReward,
    );
    return { duplicate: false, achievement, memberAchievement };
  });
  if (!result.duplicate) {
    await audit(actorId ?? null, "achievements.grant", "Achievement", result.achievement.id, { memberId, key });
  }
  return result;
}

/**
 * Check every first-time and streak milestone for a member and grant
 * whatever they newly qualify for. Safe to call after any earning event:
 * each grant is individually idempotent.
 */
export async function checkAndGrant(memberId: string): Promise<string[]> {
  const granted: string[] = [];
  const member = await prisma.discordMember.findUnique({ where: { id: memberId } });
  if (!member) return granted;
  const grantIf = async (key: string, qualifies: boolean) => {
    if (!qualifies) return;
    try {
      const result = await grantAchievement(memberId, key);
      if (!result.duplicate) granted.push(key);
    } catch (err) {
      logger.warn({ err, key, memberId }, "Achievement grant failed during check");
    }
  };
  const approvedSubmissions = await prisma.campaignSubmission.count({ where: { memberId, status: "APPROVED" } });
  const verifiedReferrals = await prisma.referral.count({ where: { referrerId: memberId, verified: true } });
  const socialPoints = await prisma.pointTransaction.count({
    where: { memberId, source: "SOCIAL_SUBMISSION", amount: { gt: 0 } },
  });
  const bestStreak = await prisma.dailyCheckin.findFirst({
    where: { memberId },
    orderBy: { streak: "desc" },
    select: { streak: true },
  });
  await grantIf("first-verification", Boolean(member.verifiedAt));
  await grantIf("first-contribution", approvedSubmissions >= 1);
  await grantIf("first-referral", verifiedReferrals >= 1);
  await grantIf("first-social", socialPoints >= 1);
  await grantIf("streak-7", (bestStreak?.streak ?? 0) >= 7);
  await grantIf("streak-30", (bestStreak?.streak ?? 0) >= 30);
  return granted;
}

/** All achievements a member holds, with definitions, newest first. */
export async function listMemberAchievements(memberId: string) {
  return prisma.memberAchievement.findMany({
    where: { memberId },
    orderBy: { awardedAt: "desc" },
    include: { achievement: true },
  });
}

/** Every active achievement definition, for the dashboard and /profile. */
export async function listAchievements() {
  return prisma.achievement.findMany({ where: { active: true }, orderBy: { threshold: "asc" } });
}

export interface CreateAchievementInput {
  key: string;
  name: string;
  description: string;
  kind: "VERIFICATION" | "CONTRIBUTION" | "REFERRAL" | "SOCIAL" | "MILESTONE" | "EVENT" | "STREAK" | "CUSTOM";
  threshold?: number;
  overpointsReward?: number;
  overcreditsReward?: number;
}

/** Staff only. Creates a custom achievement usable by grantAchievement. */
export async function createCustomAchievement(staffDiscordId: string, input: CreateAchievementInput) {
  if (!(await hasPermission(staffDiscordId, "achievements.manage"))) {
    throw new Error("You do not have permission to manage achievements");
  }
  if (!/^[a-z0-9][a-z0-9-]*$/.test(input.key)) {
    throw new Error("Achievement key must be lowercase letters, numbers and hyphens");
  }
  const existing = await prisma.achievement.findUnique({ where: { key: input.key } });
  if (existing) throw new Error(`Achievement already exists: ${input.key}`);
  const achievement = await prisma.achievement.create({
    data: {
      key: input.key,
      name: input.name,
      description: input.description,
      kind: input.kind as never,
      threshold: input.threshold ?? 1,
      overpointsReward: input.overpointsReward ?? 0,
      overcreditsReward: input.overcreditsReward ?? 0,
      active: true,
    },
  });
  await audit(staffDiscordId, "achievements.create", "Achievement", achievement.id, { key: input.key });
  return achievement;
}

/** Pure helper for tests and the dashboard: does a streak qualify for a tier. */
export function streakTier(streak: number): AchievementKey | null {
  if (streak >= 30) return "streak-30";
  if (streak >= 7) return "streak-7";
  return null;
}
