import { NextResponse } from "next/server";
import { prisma } from "../../../../lib/prisma";
import { requireStaff } from "../../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const { error } = await requireStaff(req, "economy.view");
  if (error) return error;
  try {
    const member = await prisma.discordMember.findUnique({
      where: { id: params.id },
      include: {
        user: true,
        balance: true,
        roles: { include: { role: true } },
        achievements: { include: { achievement: true }, orderBy: { awardedAt: "desc" } },
        transactions: { orderBy: { createdAt: "desc" }, take: 20 },
        checkins: { orderBy: { date: "desc" }, take: 30 },
        referralsGiven: true,
        referralsReceived: true,
      },
    });
    if (!member) return NextResponse.json({ error: "Member not found" }, { status: 404 });
    return NextResponse.json(member);
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
