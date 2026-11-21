import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  try {
    const [referrals, total, verified, retained, comrade, suspicious] = await Promise.all([
      prisma.referral.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { referrer: { include: { user: true } }, referred: { include: { user: true } } },
      }),
      prisma.referral.count(),
      prisma.referral.count({ where: { verified: true } }),
      prisma.referral.count({ where: { retained7d: true } }),
      prisma.referral.count({ where: { becameComrade: true } }),
      prisma.referral.count({ where: { suspicious: true } }),
    ]);
    return NextResponse.json({ referrals, stats: { total, verified, retained, comrade, suspicious } });
  } catch {
    return NextResponse.json({ referrals: [], stats: { total: 0, verified: 0, retained: 0, comrade: 0, suspicious: 0 } });
  }
}
