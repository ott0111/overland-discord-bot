import type { Prisma } from "@prisma/client";
import { prisma, audit } from "./db.js";
import { getConfig } from "./config.js";
import { DAILY_LIMITS } from "@overland/shared";

export interface AwardInput {
  memberId: string;
  currency: "OVERPOINTS" | "OVERCREDITS";
  category: string;
  amount: number;
  source: string;
  reason?: string;
  actorId?: string;
  idempotencyKey: string;
}

/** Prisma transaction client shared by atomic award operations. */
export type TxClient = Prisma.TransactionClient;

const CATEGORY_FIELD: Record<string, string> = {
  community: "communityPoints",
  social: "socialPoints",
  referral: "referralPoints",
  contribution: "contributionPoints",
};

async function awardWithTx(tx: TxClient, input: AwardInput) {
  if (!Number.isSafeInteger(input.amount) || input.amount === 0) {
    throw new Error("Amount must be a non-zero safe integer");
  }
  if (!input.idempotencyKey?.trim()) throw new Error("An idempotency key is required");
  if (input.currency === "OVERPOINTS" && input.amount < 0 && input.source !== "ADMIN_ADJUSTMENT") {
    throw new Error("Overpoints cannot be spent");
  }

  const existing = await tx.pointTransaction.findUnique({
    where: { idempotencyKey: input.idempotencyKey },
  });
  if (existing) return { duplicate: true, transaction: existing };

  await tx.pointBalance.upsert({
    where: { memberId: input.memberId },
    update: {},
    create: { memberId: input.memberId },
  });

  const field = input.currency === "OVERPOINTS" ? "overpoints" : "overcredits";
  const data: Record<string, unknown> = {
    [field]: input.amount > 0
      ? { increment: input.amount }
      : { decrement: Math.abs(input.amount) },
  };

  const categoryField = CATEGORY_FIELD[input.category];
  if (categoryField && input.amount > 0) {
    data[categoryField] = { increment: input.amount };
  }

  // The conditional update is atomic in PostgreSQL. Concurrent debits
  // cannot both spend the same balance and the database CHECK is a final guard.
  const where: Record<string, unknown> = { memberId: input.memberId };
  if (input.amount < 0) where[field] = { gte: Math.abs(input.amount) };

  const changed = await tx.pointBalance.updateMany({ where, data: data as never });
  if (changed.count !== 1) {
    throw new Error("Insufficient balance: transaction would make balance negative");
  }

  const updated = await tx.pointBalance.findUniqueOrThrow({
    where: { memberId: input.memberId },
  });

  const txn = await tx.pointTransaction.create({
    data: {
      memberId: input.memberId,
      currency: input.currency,
      category: input.category,
      amount: input.amount,
      balanceAfter: updated[field],
      source: input.source as never,
      idempotencyKey: input.idempotencyKey,
      reason: input.reason,
      actorId: input.actorId,
    },
  });

  return { duplicate: false, transaction: txn, balance: updated };
}

/**
 * Atomic award. Idempotent on idempotencyKey, never allows a negative
 * balance. Pass an existing transaction client as the second argument to
 * join an outer transaction (for example a campaign review that updates
 * the submission and awards points atomically); otherwise a new
 * transaction is created.
 */
export async function awardPoints(input: AwardInput, tx?: TxClient) {
  if (tx) return awardWithTx(tx, input);
  return prisma.$transaction(async (inner) => awardWithTx(inner, input));
}


/**
 * Award positive earnings under a per-member PostgreSQL advisory lock.
 * This makes the daily cap race-safe across concurrent message events,
 * submissions, referrals and check-ins. Pass a transaction client to
 * compose the award with a parent operation.
 */
export async function awardPointsWithinDailyLimit(input: AwardInput, tx?: TxClient) {
  if (!Number.isSafeInteger(input.amount) || input.amount <= 0) {
    throw new Error("Daily-limited awards must be positive safe integers");
  }

  const run = async (client: TxClient) => {
    await client.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${input.memberId}))`;
    const existing = await client.pointTransaction.findUnique({
      where: { idempotencyKey: input.idempotencyKey },
    });
    if (existing) return { duplicate: true, transaction: existing };

    const limits = await getConfig<{ overpoints: number; overcredits: number }>(
      "dailyLimits",
      DAILY_LIMITS,
    );
    const limit = input.currency === "OVERPOINTS"
      ? limits.overpoints ?? DAILY_LIMITS.overpoints
      : limits.overcredits ?? DAILY_LIMITS.overcredits;
    const since = new Date();
    since.setHours(0, 0, 0, 0);
    const earned = await client.pointTransaction.aggregate({
      where: {
        memberId: input.memberId,
        currency: input.currency,
        createdAt: { gte: since },
        amount: { gt: 0 },
      },
      _sum: { amount: true },
    });
    const earnedToday = earned._sum.amount ?? 0;
    if (earnedToday + input.amount > limit) {
      throw new Error("Daily " + input.currency.toLowerCase() + " earning limit reached");
    }
    return awardWithTx(client, input);
  };

  return tx ? run(tx) : prisma.$transaction(run);
}

export async function getBalance(memberId: string) {
  return prisma.pointBalance.upsert({ where: { memberId }, update: {}, create: { memberId } });
}

export async function dailyEarned(memberId: string, since: Date): Promise<number> {
  const rows = await prisma.pointTransaction.findMany({
    where: { memberId, createdAt: { gte: since }, amount: { gt: 0 } },
    select: { amount: true },
  });
  return rows.reduce((s: number, r: { amount: number }) => s + r.amount, 0);
}

/** Pure daily-limit check, unit tested without a database. */
export function withinDailyLimit(earnedToday: number, amount: number, limit: number): boolean {
  return earnedToday + amount <= limit;
}

function utcDayNumber(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 86400000;
}

/**
 * Pure daily-streak step, unit tested without a database. Calendar days
 * are compared in UTC. No previous check-in gives streak 1, a check-in
 * the day after the last one increments, a gap of two or more days resets
 * to 1, and checking in again on the same day keeps the current streak.
 */
export function computeDailyStreak(
  lastCheckinDate: Date | null,
  today: Date,
  previousStreak: number,
): number {
  if (!lastCheckinDate) return 1;
  const diffDays = Math.round(utcDayNumber(today) - utcDayNumber(lastCheckinDate));
  if (diffDays <= 0) return Math.max(1, previousStreak);
  if (diffDays === 1) return previousStreak + 1;
  return 1;
}

/** Overcredits streak bonus: 10 every 7th consecutive day, otherwise 0. */
export function streakBonusFor(streak: number): number {
  return streak > 0 && streak % 7 === 0 ? 10 : 0;
}

export async function adjustBalance(
  staffId: string,
  memberId: string,
  currency: "OVERPOINTS" | "OVERCREDITS",
  amount: number,
  reason: string,
) {
  const result = await awardPoints({
    memberId,
    currency,
    category: "admin",
    amount,
    source: "ADMIN_ADJUSTMENT",
    reason,
    actorId: staffId,
    idempotencyKey: `admin-${staffId}-${memberId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  });
  await audit(staffId, "economy.adjust", "PointBalance", memberId, { currency, amount, reason });
  return result;
}
