import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

function startOfDay(d: Date): Date {
  const c = new Date(d);
  c.setHours(0, 0, 0, 0);
  return c;
}

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  const zeros = {
    members: 0, openTickets: 0, pendingClaims: 0, pendingSubmissions: 0,
    pointsToday: 0, checkinsToday: 0, joinsToday: 0,
    pointsByCategory: [] as { category: string; total: number }[],
    daily: [] as { date: string; checkins: number; joins: number; points: number }[],
    db: "unavailable",
  };
  try {
    const today = startOfDay(new Date());
    const rangeStart = new Date(today);
    rangeStart.setDate(rangeStart.getDate() - 13);
    const [members, openTickets, pendingClaims, pendingSubmissions, pointsAgg, checkinsToday, joinsToday, byCategory, checkins, joins, txs] =
      await Promise.all([
        prisma.discordMember.count(),
        prisma.ticket.count({ where: { status: "OPEN" } }),
        prisma.rewardClaim.count({ where: { status: "PENDING" } }),
        prisma.campaignSubmission.count({ where: { status: "PENDING" } }),
        prisma.pointTransaction.aggregate({ _sum: { amount: true }, where: { createdAt: { gte: today }, amount: { gt: 0 } } }),
        prisma.dailyCheckin.count({ where: { createdAt: { gte: today } } }),
        prisma.discordMember.count({ where: { createdAt: { gte: today } } }),
        prisma.pointTransaction.groupBy({ by: ["category"], _sum: { amount: true }, where: { amount: { gt: 0 } } }),
        prisma.dailyCheckin.findMany({ where: { createdAt: { gte: rangeStart } }, select: { createdAt: true } }),
        prisma.discordMember.findMany({ where: { createdAt: { gte: rangeStart } }, select: { createdAt: true } }),
        prisma.pointTransaction.findMany({ where: { createdAt: { gte: rangeStart }, amount: { gt: 0 } }, select: { createdAt: true, amount: true } }),
      ]);
    const daily: { date: string; checkins: number; joins: number; points: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(today);
      day.setDate(day.getDate() - i);
      const key = day.toISOString().slice(0, 10);
      const next = new Date(day);
      next.setDate(next.getDate() + 1);
      daily.push({
        date: key,
        checkins: checkins.filter((c: { createdAt: Date }) => c.createdAt >= day && c.createdAt < next).length,
        joins: joins.filter((j: { createdAt: Date }) => j.createdAt >= day && j.createdAt < next).length,
        points: txs.filter((t: { createdAt: Date }) => t.createdAt >= day && t.createdAt < next).reduce((s: number, t: { amount: number }) => s + t.amount, 0),
      });
    }
    return NextResponse.json({
      members, openTickets, pendingClaims, pendingSubmissions,
      pointsToday: pointsAgg._sum.amount ?? 0,
      checkinsToday, joinsToday,
      pointsByCategory: (byCategory as { category: string; _sum: { amount: number | null } }[])
        .map((c) => ({ category: c.category, total: c._sum.amount ?? 0 }))
        .sort((a, b) => b.total - a.total),
      daily,
      db: "ok",
    });
  } catch {
    return NextResponse.json(zeros);
  }
}
