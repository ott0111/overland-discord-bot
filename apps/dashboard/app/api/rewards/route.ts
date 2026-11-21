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
        orderBy: { createdAt: "desc" }, take: 100,
        include: { reward: true, member: { include: { user: true } } },
      }),
    ]);
    return NextResponse.json({ rewards, claims });
  } catch {
    return NextResponse.json({ error: "Unable to load rewards" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "rewards.manage");
  if (error) return error;
  let body: { name?: string; description?: string; imageUrl?: string; costOvercredits?: number; stock?: number | null; eligibility?: string; active?: boolean };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.name?.trim() || !body.description?.trim() || typeof body.costOvercredits !== "number" ||
      !Number.isInteger(body.costOvercredits) || body.costOvercredits < 0 ||
      (body.stock !== undefined && body.stock !== null && (!Number.isInteger(body.stock) || body.stock < 0))) {
    return NextResponse.json({ error: "Provide a name, description, non-negative integer cost and valid stock" }, { status: 400 });
  }
  try {
    const reward = await prisma.reward.create({
      data: {
        name: body.name.trim(), description: body.description.trim(), imageUrl: body.imageUrl ?? null,
        costOvercredits: body.costOvercredits, stock: body.stock ?? null,
        eligibility: body.eligibility ?? null, active: body.active ?? true,
      },
    });
    await writeAudit(session?.discordId ?? null, "reward.create", "Reward", reward.id, { name: reward.name });
    return NextResponse.json(reward, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to create reward" }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  let body: {
    claimId?: string; status?: string; rewardId?: string;
    costOvercredits?: number; stock?: number | null; active?: boolean; name?: string; description?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }

  if (body.claimId && body.status) {
    const { session, error } = await requireStaff(req, "rewards.review");
    if (error) return error;
    if (!["APPROVED", "REJECTED", "FULFILLED"].includes(body.status)) {
      return NextResponse.json({ error: "Invalid claim status" }, { status: 400 });
    }
    try {
      const claim = await prisma.$transaction(async (tx) => {
        const current = await tx.rewardClaim.findUnique({ where: { id: body.claimId } });
        if (!current) throw new Error("CLAIM_NOT_FOUND");
        const allowed = body.status === "APPROVED"
          ? current.status === "PENDING"
          : body.status === "REJECTED"
            ? current.status === "PENDING" || current.status === "APPROVED"
            : current.status === "APPROVED";
        if (!allowed) throw new Error("INVALID_TRANSITION");

        const transition = await tx.rewardClaim.updateMany({
          where: {
            id: current.id,
            status: body.status === "FULFILLED" ? "APPROVED" : "PENDING",
          },
          data: { status: body.status as never, reviewedBy: session?.discordId ?? null },
        });
        if (transition.count !== 1) throw new Error("INVALID_TRANSITION");

        if (body.status === "REJECTED") {
          const balance = await tx.pointBalance.findUnique({ where: { memberId: current.memberId } });
          const updatedBalance = balance
            ? await tx.pointBalance.update({
                where: { memberId: current.memberId },
                data: { overcredits: { increment: current.costOvercredits } },
              })
            : await tx.pointBalance.create({
                data: { memberId: current.memberId, overcredits: current.costOvercredits },
              });
          await tx.pointTransaction.create({
            data: {
              memberId: current.memberId, currency: "OVERCREDITS", category: "reward",
              amount: current.costOvercredits, balanceAfter: updatedBalance.overcredits,
              source: "REWARD_CLAIM", idempotencyKey: "refund-" + current.id,
              reason: "Refund for rejected claim " + current.id, actorId: session?.discordId ?? null,
            },
          });
          const reward = await tx.reward.findUnique({ where: { id: current.rewardId } });
          if (reward && reward.stock !== null) {
            await tx.reward.update({ where: { id: reward.id }, data: { stock: { increment: 1 } } });
          }
        }
        return tx.rewardClaim.findUnique({ where: { id: current.id } });
      });
      await writeAudit(session?.discordId ?? null, "reward.claim." + body.status.toLowerCase(), "RewardClaim", body.claimId, {
        refunded: body.status === "REJECTED",
      });
      return NextResponse.json(claim);
    } catch (err) {
      if (err instanceof Error && err.message === "CLAIM_NOT_FOUND") return NextResponse.json({ error: "Claim not found" }, { status: 404 });
      if (err instanceof Error && err.message === "INVALID_TRANSITION") return NextResponse.json({ error: "Claim status changed or this transition is not allowed" }, { status: 409 });
      return NextResponse.json({ error: "Unable to update claim" }, { status: 503 });
    }
  }

  if (body.rewardId) {
    const { session, error } = await requireStaff(req, "rewards.manage");
    if (error) return error;
    if (body.costOvercredits !== undefined && (!Number.isInteger(body.costOvercredits) || body.costOvercredits < 0)) {
      return NextResponse.json({ error: "Reward cost must be a non-negative integer" }, { status: 400 });
    }
    if (body.stock !== undefined && body.stock !== null && (!Number.isInteger(body.stock) || body.stock < 0)) {
      return NextResponse.json({ error: "Stock must be a non-negative integer or null" }, { status: 400 });
    }
    try {
      const reward = await prisma.reward.update({
        where: { id: body.rewardId },
        data: {
          ...(body.costOvercredits !== undefined ? { costOvercredits: body.costOvercredits } : {}),
          ...(body.stock !== undefined ? { stock: body.stock } : {}),
          ...(body.active !== undefined ? { active: body.active } : {}),
          ...(body.name !== undefined ? { name: body.name.trim() } : {}),
          ...(body.description !== undefined ? { description: body.description.trim() } : {}),
        },
      });
      await writeAudit(session?.discordId ?? null, "reward.update", "Reward", reward.id, { name: reward.name });
      return NextResponse.json(reward);
    } catch {
      return NextResponse.json({ error: "Unable to update reward" }, { status: 503 });
    }
  }
  return NextResponse.json({ error: "claimId/status or rewardId is required" }, { status: 400 });
}
