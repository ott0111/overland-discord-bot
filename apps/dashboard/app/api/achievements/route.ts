import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  try {
    const achievements = await prisma.achievement.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { members: true } } },
    });
    return NextResponse.json(achievements);
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "achievements.manage");
  if (error) return error;
  const body = (await req.json()) as {
    key?: string; name?: string; description?: string; kind?: string;
    threshold?: number; overpointsReward?: number; overcreditsReward?: number;
  };
  if (!body.name || !body.description) {
    return NextResponse.json({ error: "name and description are required" }, { status: 400 });
  }
  const key = (body.key ?? body.name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "achievement-" + Date.now();
  try {
    const achievement = await prisma.achievement.create({
      data: {
        key,
        name: body.name,
        description: body.description,
        kind: (body.kind as never) ?? "CUSTOM",
        threshold: body.threshold ?? 1,
        overpointsReward: body.overpointsReward ?? 0,
        overcreditsReward: body.overcreditsReward ?? 0,
      },
    });
    await writeAudit(session?.discordId ?? null, "achievement.create", "Achievement", achievement.id, { key });
    return NextResponse.json(achievement, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database unavailable or key already exists" }, { status: 503 });
  }
}
