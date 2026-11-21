import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  try {
    const [rewards, claims] = await Promise.all([
      prisma.reward.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { claims: true } } } }),
      prisma.rewardClaim.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { reward: true, member: { include: { user: true } } },
      }),
    ]);
    return NextResponse.json({ rewards, claims });
  } catch {
    return NextResponse.json({ rewards: [], claims: [] });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "rewards.manage");
  if (error) return error;
  const body = (await req.json()) as {
    name?: string; description?: string; imageUrl?: string; costOvercredits?: number;
    stock?: number | null; eligibility?: string; active?: boolean;
  };
  if (!body.name || !body.description || typeof body.costOvercredits !== "number") {
    return NextResponse.json({ error: "name, description and costOvercredits are required" }, { status: 400 });
  }
  try {
    const reward = await prisma.reward.create({
      data: {
        name: body.name,
        description: body.description,
        imageUrl: body.imageUrl ?? null,
        costOvercredits: body.costOvercredits,
        stock: body.stock ?? null,
        eligibility: body.eligibility ?? null,
        active: body.active ?? true,
      },
    });
    await writeAudit(session?.discordId ?? null, "reward.create", "Reward", reward.id, { name: body.name });
    return NextResponse.json(reward, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await requireStaff(req, "rewards.review");
  if (error) return error;
  const body = (await req.json()) as {
    claimId?: string; status?: string; rewardId?: string;
    costOvercredits?: number; stock?: number | null; active?: boolean; name?: string; description?: string;
  };
  try {
    if (body.claimId && body.status) {
      if (!["APPROVED", "REJECTED", "FULFILLED", "CANCELLED"].includes(body.status)) {
        return NextResponse.json({ error: "Invalid claim status" }, { status: 400 });
      }
      // Overcredits were deducted atomically at claim time in the bot, so a
      // staff decision only changes status here, never moves points twice.
      const claim = await prisma.rewardClaim.update({
        where: { id: body.claimId },
        data: { status: body.status as never, reviewedBy: session?.discordId ?? null },
      });
      await writeAudit(session?.discordId ?? null, "reward.claim." + body.status.toLowerCase(), "RewardClaim", claim.id);
      return NextResponse.json(claim);
    }
    if (body.rewardId) {
      const reward = await prisma.reward.update({
        where: { id: body.rewardId },
        data: {
          ...(body.costOvercredits !== undefined ? { costOvercredits: body.costOvercredits } : {}),
          ...(body.stock !== undefined ? { stock: body.stock } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
        },
      });
      await writeAudit(session?.discordId ?? null, "reward.update", "Reward", reward.id, { name: reward.name });
      return NextResponse.json(reward);
    }
    return NextResponse.json({ error: "claimId or rewardId is required" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Database unavailable or record not found" }, { status: 503 });
  }
}
