import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

const FIELDS: Record<string, string> = {
  overall: "overpoints",
  community: "communityPoints",
  social: "socialPoints",
  referrals: "referralPoints",
  contributions: "contributionPoints",
};

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const category = params.get("category") ?? "overall";
  const period = params.get("period") ?? "LIFETIME";
  const field = FIELDS[category] ?? "overpoints";
  try {
    if (period === "LIFETIME") {
      const rows = await prisma.pointBalance.findMany({
        orderBy: { [field]: "desc" },
        take: 20,
        include: { member: { include: { user: true } } },
      });
      return NextResponse.json(rows.map((r: { member: { user: { username: string; discordId: string } }; [k: string]: unknown }, i: number) => ({
        rank: i + 1,
        username: r.member.user.username,
        discordId: r.member.user.discordId,
        score: (r as Record<string, unknown>)[field] as number,
      })));
    }
    const start = new Date();
    if (period === "WEEKLY") start.setDate(start.getDate() - 7);
    else start.setDate(start.getDate() - 30);
    const grouped = await prisma.pointTransaction.groupBy({
      by: ["memberId"],
      _sum: { amount: true },
      where: { createdAt: { gte: start }, amount: { gt: 0 }, ...(category === "overall" ? {} : { category }) },
      orderBy: { _sum: { amount: "desc" } },
      take: 20,
    });
    const members = await prisma.discordMember.findMany({
      where: { id: { in: grouped.map((g: { memberId: string }) => g.memberId) } },
      include: { user: true },
    });
    const byId = new Map<string, { username: string; discordId: string }>(
      members.map((m: { id: string; user: { username: string; discordId: string } }) => [m.id, m.user] as [string, { username: string; discordId: string }]),
    );
    return NextResponse.json(
      grouped.map((g: { memberId: string; _sum: { amount: number | null } }, i: number) => ({
        rank: i + 1,
        username: byId.get(g.memberId)?.username ?? "Unknown",
        discordId: byId.get(g.memberId)?.discordId ?? "",
        score: g._sum.amount ?? 0,
      })),
    );
  } catch {
    return NextResponse.json([]);
  }
}
