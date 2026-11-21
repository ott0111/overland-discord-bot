import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "moderation.view");
  if (error) return error;
  try {
    const actions = await prisma.moderationAction.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { target: { include: { user: true } } },
    });
    return NextResponse.json(actions);
  } catch {
    return NextResponse.json([]);
  }
}
