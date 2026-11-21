import { prisma, audit } from "../../lib/db.js";
import { getConfig } from "../../lib/config.js";
import { isSuspiciousAccount } from "../../lib/antifraud.js";
import { hasPermission } from "../../lib/permissions.js";
import { grantCitizenAfterVerification } from "../roles/service.js";
import { grantAchievement, checkAndGrant } from "../achievements/service.js";
import { logger } from "../../lib/logger.js";
import { verifyReferral } from "../referrals/service.js";

export interface VerificationCheck { passed: boolean; reasons: string[]; }

/** CAPTCHA challenge: staff-configured question, answer checked case-insensitively. */
export function checkCaptchaAnswer(expected: string, given: string): boolean {
  return expected.trim().toLowerCase() === given.trim().toLowerCase();
}

export function verificationCheck(
  accountAgeDays: number,
  minAgeDays: number,
  hasAvatar: boolean,
  captchaPassed: boolean,
  requireAvatar = false,
): VerificationCheck {
  const reasons: string[] = [];
  if (accountAgeDays < minAgeDays) reasons.push("Account is too new");
  if (requireAvatar && !hasAvatar) reasons.push("An avatar is required for verification");
  if (!captchaPassed) reasons.push("Verification challenge not passed");
  return { passed: reasons.length === 0, reasons };
}

export interface CaptchaChallenge {
  id: string;
  question: string;
  answer: string;
}

/**
 * Simple knowledge challenges (no external CAPTCHA service, no PII).
 * The answer is kept server side in a short lived in-memory map and is
 * never sent to the member. Challenges expire after 10 minutes.
 */
export const CAPTCHA_CHALLENGES: Array<{ question: string; answer: string }> = [
  { question: "What is the name of the community currency you earn by checking in daily? (one word)", answer: "overpoints" },
  { question: "Overland Finance is the commerce layer for what kind of dollars? (one word)", answer: "digital" },
  { question: "What blockchain does Overland Finance build its first checkout on? (one word)", answer: "solana" },
  { question: "What is 3 + 4? (a number)", answer: "7" },
];

const pendingChallenges = new Map<string, { challenge: CaptchaChallenge; expiresAt: number }>();

export function generateChallenge(memberId: string): { id: string; question: string } {
  const picked = CAPTCHA_CHALLENGES[Math.floor(Math.random() * CAPTCHA_CHALLENGES.length)];
  const challenge: CaptchaChallenge = { id: `ch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, ...picked };
  pendingChallenges.set(memberId, { challenge, expiresAt: Date.now() + 10 * 60 * 1000 });
  return { id: challenge.id, question: challenge.question };
}

function consumeChallenge(memberId: string, challengeId: string): CaptchaChallenge | null {
  const entry = pendingChallenges.get(memberId);
  if (!entry || entry.challenge.id !== challengeId) return null;
  pendingChallenges.delete(memberId);
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}

export interface VerificationConfig {
  minAccountAgeDays: number;
  requireCaptcha: boolean;
  requireAvatar: boolean;
  antiRaidWindowMinutes: number;
  antiRaidThreshold: number;
}

export async function getVerificationConfig(): Promise<VerificationConfig> {
  const defaults: VerificationConfig = {
    minAccountAgeDays: 7,
    requireCaptcha: true,
    requireAvatar: false,
    antiRaidWindowMinutes: 10,
    antiRaidThreshold: 10,
  };
  const stored = await getConfig<Partial<VerificationConfig>>("verification", {});
  return { ...defaults, ...stored };
}

/**
 * Anti-raid check: counts members who joined the guild in the recent
 * window. Returns true when joins exceed the threshold, in which case
 * verification should be held for staff review instead of auto-granting.
 */
export async function checkAntiRaid(guildId: string, windowMinutes = 10, threshold = 10): Promise<{ raiding: boolean; recentJoins: number }> {
  const since = new Date(Date.now() - windowMinutes * 60 * 1000);
  const recentJoins = await prisma.discordMember.count({
    where: { guildId, joinedAt: { gte: since } },
  });
  return { raiding: recentJoins >= threshold, recentJoins };
}

/**
 * Start verification for a member. Runs the account-age and suspicious
 * checks and the anti-raid check, and issues a challenge when one is
 * required. Returns the reasons when verification cannot proceed.
 */
export async function startVerification(memberId: string, accountAgeDays: number, hasAvatar: boolean, guildId?: string) {
  const config = await getVerificationConfig();
  const reasons: string[] = [];
  if (accountAgeDays < config.minAccountAgeDays) {
    reasons.push(`Account is too new (minimum ${config.minAccountAgeDays} days old)`);
  }
  if (!hasAvatar && config.requireAvatar) reasons.push("An avatar is required for verification");
  if (isSuspiciousAccount(accountAgeDays, config.minAccountAgeDays, hasAvatar)) {
    await prisma.discordMember.update({ where: { id: memberId }, data: { isSuspicious: true } }).catch(() => undefined);
  }
  let raid: { raiding: boolean; recentJoins: number } | null = null;
  if (guildId) {
    raid = await checkAntiRaid(guildId, config.antiRaidWindowMinutes, config.antiRaidThreshold);
    if (raid.raiding) reasons.push("Anti-raid protection is active: verification is paused for staff review");
  }
  if (reasons.length > 0) return { passed: false, reasons, challenge: null, raid };
  const challenge = config.requireCaptcha ? generateChallenge(memberId) : null;
  return { passed: true, reasons: [], challenge, raid };
}

/**
 * Complete verification: checks the challenge answer, re-runs the
 * account checks, then grants Citizen and the first-verification
 * achievement. The challenge is single use and expires.
 */
export async function completeVerification(
  memberId: string,
  challengeId: string | null,
  answer: string,
  accountAgeDays: number,
  hasAvatar: boolean,
  actorId: string,
  guild?: import("discord.js").Guild,
) {
  const config = await getVerificationConfig();
  let captchaPassed = !config.requireCaptcha;
  if (config.requireCaptcha) {
    if (!challengeId) throw new Error("A verification challenge is required");
    const challenge = consumeChallenge(memberId, challengeId);
    if (!challenge) throw new Error("Verification challenge expired or not found. Start verification again.");
    captchaPassed = checkCaptchaAnswer(challenge.answer, answer);
  }
  const check = verificationCheck(accountAgeDays, config.minAccountAgeDays, hasAvatar, captchaPassed, config.requireAvatar);
  if (!check.passed) throw new Error(`Verification failed: ${check.reasons.join("; ")}`);
  await grantCitizenAfterVerification(memberId, actorId, guild);
  const referral = await prisma.referral.findFirst({ where: { referredId: memberId } });
  if (referral) {
    await verifyReferral(referral.id).catch((err) =>
      logger.warn({ err, referralId: referral.id }, "Referral verification after Citizen grant failed"));
  }
  try {
    await grantAchievement(memberId, "first-verification", actorId);
  } catch (err) {
    logger.warn({ err, memberId }, "First-verification achievement grant failed");
  }
  await audit(actorId, "verification.complete", "DiscordMember", memberId, {});
  return { verified: true };
}

/**
 * Staff verification bypass: a staff member with roles.assign verifies a
 * member directly (used for manual review of flagged accounts). Grants
 * Citizen and runs the achievement check.
 */
export async function staffVerify(memberDiscordId: string, staffDiscordId: string, guild?: import("discord.js").Guild) {
  if (!(await hasPermission(staffDiscordId, "roles.assign"))) {
    throw new Error("You do not have permission to verify members");
  }
  const user = await prisma.user.findUnique({ where: { discordId: memberDiscordId } });
  if (!user) throw new Error("Member not found");
  const member = await prisma.discordMember.findUnique({ where: { userId: user.id } });
  if (!member) throw new Error("Member record not found");
  await grantCitizenAfterVerification(member.id, staffDiscordId, guild);
  const referral = await prisma.referral.findFirst({ where: { referredId: member.id } });
  if (referral) {
    await verifyReferral(referral.id).catch((err) =>
      logger.warn({ err, referralId: referral.id }, "Referral verification after staff Citizen grant failed"));
  }
  try {
    await checkAndGrant(member.id);
  } catch (err) {
    logger.warn({ err, memberId: member.id }, "Achievement check after staff verification failed");
  }
  await audit(staffDiscordId, "verification.staff", "DiscordMember", member.id, {});
  return member;
}
