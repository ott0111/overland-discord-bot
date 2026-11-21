import { prisma } from "../../lib/db.js";

export function leaderboardField(category: string): string {
  const m: Record<string, string> = {
    overall: "overpoints",
    community: "communityPoints",
    social: "socialPoints",
    referrals: "referralPoints",
    contributions: "contributionPoints",
  };
  return m[category] ?? "overpoints";
}

export type LeaderboardCategory = "overall" | "community" | "social" | "referrals" | "contributions";
export type LeaderboardPeriod = "LIFETIME" | "MONTHLY" | "WEEKLY";

export interface LeaderboardRow {
  rank: number;
  memberId: string;
  username: string;
  score: number;
}

/** Current month key, YYYY-MM. */
export function currentMonthKey(now = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** Current ISO week key, YYYY-Www. */
export function currentWeekKey(now = new Date()): string {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  const day = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const week = 1 + Math.round((date.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function periodKeyFor(period: LeaderboardPeriod, now = new Date()): string {
  if (period === "MONTHLY") return currentMonthKey(now);
  if (period === "WEEKLY") return currentWeekKey(now);
  return "lifetime";
}

export { periodKeyFor };

async function usernamesFor(memberIds: string[]): Promise<Map<string, string>> {
  const members = await prisma.discordMember.findMany({
    where: { id: { in: memberIds } },
    include: { user: true },
  });
  return new Map(members.map((m: { id: string; user: { username: string } }) => [m.id, m.user.username]));
}

/**
 * Get a leaderboard page. LIFETIME reads live PointBalance rows; MONTHLY
 * and WEEKLY read LeaderboardSnapshot rows written by snapshotLeaderboard,
 * so a period reset never erases lifetime statistics.
 */
export async function getLeaderboard(
  category: LeaderboardCategory | string,
  period: LeaderboardPeriod | string = "LIFETIME",
  page = 1,
  perPage = 10,
): Promise<{ rows: LeaderboardRow[]; page: number; perPage: number; period: string; category: string }> {
  const safePage = Math.max(1, page);
  const field = leaderboardField(category);
  if (period === "LIFETIME") {
    const balances = await prisma.pointBalance.findMany({
      orderBy: { [field]: "desc" },
      take: perPage,
      skip: (safePage - 1) * perPage,
    });
    const names = await usernamesFor(balances.map((b: { memberId: string }) => b.memberId));
    return {
      rows: balances.map((b: any, idx: number) => ({
        rank: (safePage - 1) * perPage + idx + 1,
        memberId: b.memberId,
        username: names.get(b.memberId) ?? "Unknown",
        score: (b as unknown as Record<string, number>)[field] ?? 0,
      })),
      page: safePage,
      perPage,
      period,
      category,
    };
  }
  const key = periodKeyFor(period as LeaderboardPeriod);
  const snapshots = await prisma.leaderboardSnapshot.findMany({
    where: { period: period as never, category, periodKey: key },
    orderBy: { rank: "asc" },
    take: perPage,
    skip: (safePage - 1) * perPage,
  });
  const names = await usernamesFor(snapshots.map((s: { memberId: string }) => s.memberId));
  return {
    rows: snapshots.map((s: any) => ({
      rank: s.rank,
      memberId: s.memberId,
      username: names.get(s.memberId) ?? "Unknown",
      score: s.score,
    })),
    page: safePage,
    perPage,
    period,
    category,
  };
}

/**
 * Snapshot the current top 100 for every category into MONTHLY and WEEKLY
 * snapshots. Re-running for the same period key replaces the old rows, so
 * scheduled snapshots are idempotent and duplicate jobs cannot double
 * count. Lifetime balances are never touched.
 */
export async function snapshotLeaderboard(now = new Date()) {
  const categories: LeaderboardCategory[] = ["overall", "community", "social", "referrals", "contributions"];
  const periods: Array<{ period: LeaderboardPeriod; key: string; start: Date }> = [
    {
      period: "MONTHLY",
      key: currentMonthKey(now),
      start: new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)),
    },
    {
      period: "WEEKLY",
      key: currentWeekKey(now),
      start: (() => {
        const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
        const day = (start.getUTCDay() + 6) % 7;
        start.setUTCDate(start.getUTCDate() - day);
        return start;
      })(),
    },
  ];

  let written = 0;
  await prisma.$transaction(async (tx) => {
    for (const { period, key, start } of periods) {
      for (const category of categories) {
        const rows = await tx.pointTransaction.groupBy({
          by: ["memberId"],
          where: {
            currency: "OVERPOINTS",
            amount: { gt: 0 },
            createdAt: { gte: start, lte: now },
            ...(category === "overall" ? {} : { category }),
          },
          _sum: { amount: true },
          orderBy: { _sum: { amount: "desc" } },
          take: 100,
        });

        await tx.leaderboardSnapshot.deleteMany({
          where: { period, category, periodKey: key },
        });

        if (rows.length > 0) {
          await tx.leaderboardSnapshot.createMany({
            data: rows.map((row, index) => ({
              period,
              category,
              periodKey: key,
              memberId: row.memberId,
              rank: index + 1,
              score: row._sum.amount ?? 0,
            })),
          });
        }
        written += rows.length;
      }
    }
  });

  return { written, monthKey: currentMonthKey(now), weekKey: currentWeekKey(now) };
}

/** Overall rank of one member by lifetime Overpoints (1 based). */
export async function getMemberRank(memberId: string): Promise<number> {
  const balance = await prisma.pointBalance.findUnique({ where: { memberId } });
  if (!balance) return 0;
  return (await prisma.pointBalance.count({ where: { overpoints: { gt: balance.overpoints } } })) + 1;
}

export interface LeaderboardPage<T> {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  rows: T[];
}

/**
 * Pure leaderboard pagination, unit tested without a database. Pages are
 * 1-based and clamped to the available range, page size is clamped to
 * 1..100, and the returned rows are the slice for that page. Lifetime
 * totals are never touched by paging: this only slices an already
 * fetched, already ordered list.
 */
export function paginateLeaderboard<T>(rows: readonly T[], page = 1, pageSize = 10): LeaderboardPage<T> {
  const size = Math.min(100, Math.max(1, Math.floor(pageSize) || 10));
  const totalPages = Math.max(1, Math.ceil(rows.length / size));
  const p = Math.min(Math.max(1, Math.floor(page) || 1), totalPages);
  const start = (p - 1) * size;
  return { page: p, pageSize: size, total: rows.length, totalPages, rows: rows.slice(start, start + size) };
}
