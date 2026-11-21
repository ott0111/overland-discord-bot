import { awardPoints } from "../../lib/points.js";
import { getPointValues, getConfig } from "../../lib/config.js";
import { withinDailyLimit, dailyEarned, streakBonusFor } from "../../lib/points.js";
import { DAILY_LIMITS } from "@overland/shared";

export async function awardDailyCheckin(memberId: string, streak: number) {
  const values = await getPointValues();
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const earned = await dailyEarned(memberId, today);
  const amount = (values.community as unknown as Record<string, number>).dailyCheckin as number;
  if (!withinDailyLimit(earned, amount, 100)) throw new Error("Daily earning limit reached");
  const streakBonus = streakBonusFor(streak);
  const key = `daily-${memberId}-${today.toISOString().slice(0, 10)}`;
  const r = await awardPoints({ memberId, currency: "OVERPOINTS", category: "community", amount, source: "DAILY_CHECKIN", reason: `Daily check-in, streak ${streak}`, idempotencyKey: key });
  if (streakBonus > 0 && !r.duplicate) await awardPoints({ memberId, currency: "OVERCREDITS", category: "community", amount: streakBonus, source: "STREAK_BONUS", reason: "Weekly streak bonus", idempotencyKey: `${key}-streak` });
  return r;
}

async function dailyLimit(): Promise<number> {
  const limits = await getConfig<{ overpoints: number }>("dailyLimits", DAILY_LIMITS);
  return limits.overpoints ?? DAILY_LIMITS.overpoints;
}

function startOfToday(): Date {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return today;
}

/**
 * Shared guard for community earning: enforces the daily Overpoints cap
 * before any award is attempted. Throws when the award would exceed it.
 */
async function checkDailyCap(memberId: string, amount: number): Promise<void> {
  const earned = await dailyEarned(memberId, startOfToday());
  if (!withinDailyLimit(earned, amount, await dailyLimit())) {
    throw new Error("Daily earning limit reached");
  }
}

/**
 * Meaningful participation (2 points). One award per message id, and at
 * most DAILY_LIMITS.messagesRewarded rewarded messages per member per day,
 * so raw message volume is never farmed.
 */
export async function awardParticipation(memberId: string, messageId: string) {
  const values = await getPointValues();
  const amount = (values.community as unknown as Record<string, number>).participation as number;
  await checkDailyCap(memberId, amount);
  return awardPoints({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount,
    source: "PARTICIPATION",
    reason: "Meaningful daily participation",
    idempotencyKey: `msg-${messageId}`,
  });
}

/**
 * Helpful answer (5 points). The reference (usually the message id of the
 * answer) makes the award idempotent per answer, so the same answer can
 * never be rewarded twice.
 */
export async function awardHelpful(memberId: string, reference: string, actorId?: string) {
  const values = await getPointValues();
  const amount = (values.community as unknown as Record<string, number>).helpfulAnswer as number;
  await checkDailyCap(memberId, amount);
  return awardPoints({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount,
    source: "HELPFUL_ANSWER",
    reason: "Helpful answer",
    actorId,
    idempotencyKey: `helpful-${reference}`,
  });
}

/** Community event participation (15 points), once per event per member. */
export async function awardEvent(memberId: string, eventId: string) {
  const values = await getPointValues();
  const amount = (values.community as unknown as Record<string, number>).eventParticipation as number;
  await checkDailyCap(memberId, amount);
  return awardPoints({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount,
    source: "EVENT",
    reason: `Event participation: ${eventId}`,
    idempotencyKey: `event-${eventId}-${memberId}`,
  });
}

/** Weekly challenge completion (20 points), once per week key per member. */
export async function awardWeeklyChallenge(memberId: string, weekKey: string) {
  const values = await getPointValues();
  const amount = (values.community as unknown as Record<string, number>).weeklyChallenge as number;
  await checkDailyCap(memberId, amount);
  return awardPoints({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount,
    source: "WEEKLY_CHALLENGE",
    reason: `Weekly challenge completed: ${weekKey}`,
    idempotencyKey: `weekly-${weekKey}-${memberId}`,
  });
}

/** Approved community contribution (20 points), once per contribution id. */
export async function awardApprovedContribution(memberId: string, contributionId: string, actorId?: string) {
  const values = await getPointValues();
  const amount = (values.community as unknown as Record<string, number>).approvedContribution as number;
  await checkDailyCap(memberId, amount);
  return awardPoints({
    memberId,
    currency: "OVERPOINTS",
    category: "contribution",
    amount,
    source: "CONTRIBUTION",
    reason: "Approved community contribution",
    actorId,
    idempotencyKey: `contribution-${contributionId}`,
  });
}
