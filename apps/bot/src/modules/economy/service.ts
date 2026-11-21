import { awardPointsWithinDailyLimit } from "../../lib/points.js";
import { getPointValues } from "../../lib/config.js";

type PointValues = Record<string, Record<string, number>>;

function pointValues(values: unknown): PointValues {
  return values as PointValues;
}

export async function awardDailyCheckin(memberId: string, streak: number) {
  const values = pointValues(await getPointValues());
  const amount = values.community.dailyCheckin ?? 5;
  const key = "daily-" + memberId + "-" + new Date().toISOString().slice(0, 10);
  const result = await awardPointsWithinDailyLimit({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount,
    source: "DAILY_CHECKIN",
    reason: "Daily check-in, streak " + streak,
    idempotencyKey: key,
  });

  const streakBonus = streak > 0 && streak % 7 === 0 && !result.duplicate ? 10 : 0;
  if (streakBonus > 0) {
    await awardPointsWithinDailyLimit({
      memberId,
      currency: "OVERCREDITS",
      category: "community",
      amount: streakBonus,
      source: "STREAK_BONUS",
      reason: "Weekly streak bonus",
      idempotencyKey: key + "-streak",
    });
  }
  return { ...result, amount, streakBonus };
}

export async function awardParticipation(memberId: string, messageId: string) {
  const values = pointValues(await getPointValues());
  return awardPointsWithinDailyLimit({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount: values.community.participation ?? 2,
    source: "PARTICIPATION",
    reason: "Meaningful daily participation",
    idempotencyKey: "msg-" + messageId,
  });
}

export async function awardHelpful(memberId: string, reference: string, actorId?: string) {
  const values = pointValues(await getPointValues());
  return awardPointsWithinDailyLimit({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount: values.community.helpfulAnswer ?? 5,
    source: "HELPFUL_ANSWER",
    reason: "Helpful answer",
    actorId,
    idempotencyKey: "helpful-" + reference,
  });
}

export async function awardEvent(memberId: string, eventId: string) {
  const values = pointValues(await getPointValues());
  return awardPointsWithinDailyLimit({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount: values.community.eventParticipation ?? 15,
    source: "EVENT",
    reason: "Event participation: " + eventId,
    idempotencyKey: "event-" + eventId + "-" + memberId,
  });
}

export async function awardWeeklyChallenge(memberId: string, weekKey: string) {
  const values = pointValues(await getPointValues());
  return awardPointsWithinDailyLimit({
    memberId,
    currency: "OVERPOINTS",
    category: "community",
    amount: values.community.weeklyChallenge ?? 20,
    source: "WEEKLY_CHALLENGE",
    reason: "Weekly challenge completed: " + weekKey,
    idempotencyKey: "weekly-" + weekKey + "-" + memberId,
  });
}

export async function awardApprovedContribution(memberId: string, contributionId: string, actorId?: string) {
  const values = pointValues(await getPointValues());
  return awardPointsWithinDailyLimit({
    memberId,
    currency: "OVERPOINTS",
    category: "contribution",
    amount: values.community.approvedContribution ?? 20,
    source: "CONTRIBUTION",
    reason: "Approved community contribution",
    actorId,
    idempotencyKey: "contribution-" + contributionId,
  });
}
