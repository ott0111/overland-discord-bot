import type { Prisma } from "@prisma/client";
import { prisma, audit } from "./db.js";

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
  if (input.amount === 0) throw new Error("Amount must not be zero");
  const existing = (await (tx.pointTransaction.findUnique as (a: unknown) => Promise<{ id: string } | null>)({
    where: { idempotencyKey: input.idempotencyKey },
  })) as { id: string } | null;
  if (existing) return { duplicate: true, transaction: existing };
  type Balance = Record<string, number> & { memberId: string };
  let balance = (await (tx.pointBalance.findUnique as (a: unknown) => Promise<Balance | null>)({
    where: { memberId: input.memberId },
  })) as Balance | null;
  if (!balance) {
    balance = (await (tx.pointBalance.create as (a: unknown) => Promise<Balance>)({
      data: { memberId: input.memberId },
    })) as Balance;
  }
  const field = input.currency === "OVERPOINTS" ? "overpoints" : "overcredits";
  const after = (balance[field] as number) + input.amount;
  if (after < 0) throw new Error("Insufficient balance: award would make balance negative");
  const catField = CATEGORY_FIELD[input.category];
  const data: Record<string, number> = { [field]: after };
  if (catField && input.amount > 0) data[catField] = (balance[catField] as number) + input.amount;
  const updated = (await (tx.pointBalance.update as (a: unknown) => Promise<Balance>)({
    where: { memberId: input.memberId },
    data,
  })) as Balance;
  const txn = await (tx as unknown as {
    pointTransaction: { create: (args: unknown) => Promise<unknown> };
  }).pointTransaction.create({
    data: {
      memberId: input.memberId,
      currency: input.currency,
      category: input.category,
      amount: input.amount,
      balanceAfter: after,
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
