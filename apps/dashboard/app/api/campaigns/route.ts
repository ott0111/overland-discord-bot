import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  try {
    const [campaigns, submissions] = await Promise.all([
      prisma.campaign.findMany({ orderBy: { createdAt: "desc" }, include: { _count: { select: { submissions: true } } } }),
      prisma.campaignSubmission.findMany({
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { campaign: true, member: { include: { user: true } } },
      }),
    ]);
    return NextResponse.json({ campaigns, submissions });
  } catch {
    return NextResponse.json({ error: "Unable to load campaigns" }, { status: 503 });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "campaigns.manage");
  if (error) return error;
  let body: {
    name?: string; description?: string; objectives?: string; startsAt?: string; endsAt?: string;
    pointReward?: number; submissionRequirements?: string; tasks?: string; status?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.name?.trim() || !body.description?.trim() || !body.startsAt || !body.endsAt) {
    return NextResponse.json({ error: "name, description, startsAt and endsAt are required" }, { status: 400 });
  }
  const startsAt = new Date(body.startsAt);
  const endsAt = new Date(body.endsAt);
  const pointReward = body.pointReward ?? 0;
  if (Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt ||
      !Number.isSafeInteger(pointReward) || pointReward < 0 || pointReward > 1000000) {
    return NextResponse.json({ error: "Campaign dates or point reward are invalid" }, { status: 400 });
  }
  if (body.status && !["DRAFT", "ACTIVE", "PAUSED", "COMPLETED"].includes(body.status)) {
    return NextResponse.json({ error: "Invalid campaign status" }, { status: 400 });
  }
  try {
    const campaign = await prisma.campaign.create({
      data: {
        name: body.name.trim(),
        description: body.description.trim(),
        objectives: body.objectives ?? null,
        startsAt,
        endsAt,
        pointReward,
        submissionRequirements: body.submissionRequirements ?? null,
        tasks: body.tasks ? body.tasks.split("\n").map((t) => t.trim()).filter(Boolean) : [],
        status: (body.status as never) ?? "DRAFT",
        createdBy: session?.discordId ?? null,
      },
    });
    await writeAudit(session?.discordId ?? null, "campaign.create", "Campaign", campaign.id, { name: campaign.name });
    return NextResponse.json(campaign, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Unable to create campaign" }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await requireStaff(req, "campaigns.review");
  if (error) return error;
  let body: { submissionId?: string; status?: string; feedback?: string; pointsAwarded?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.submissionId || !body.status) return NextResponse.json({ error: "submissionId and status are required" }, { status: 400 });
  if (body.status !== "APPROVED" && body.status !== "REJECTED") {
    return NextResponse.json({ error: "status must be APPROVED or REJECTED" }, { status: 400 });
  }
  if (body.pointsAwarded !== undefined && (!Number.isSafeInteger(body.pointsAwarded) || body.pointsAwarded < 0 || body.pointsAwarded > 1000000)) {
    return NextResponse.json({ error: "pointsAwarded must be a non-negative integer up to 1,000,000" }, { status: 400 });
  }
  try {
    const sub = await prisma.campaignSubmission.findUnique({
      where: { id: body.submissionId },
      include: { campaign: true },
    });
    if (!sub) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    if (sub.status !== "PENDING") return NextResponse.json({ error: "Submission already reviewed" }, { status: 409 });
    const points = body.status === "APPROVED" ? body.pointsAwarded ?? sub.campaign.pointReward : 0;

    await prisma.$transaction(async (tx: Prisma.TransactionClient) => {
      const transition = await tx.campaignSubmission.updateMany({
        where: { id: sub.id, status: "PENDING" },
        data: {
          status: body.status as never,
          feedback: body.feedback ?? null,
          pointsAwarded: points,
          reviewedBy: session?.discordId ?? null,
          reviewedAt: new Date(),
        },
      });
      if (transition.count !== 1) throw new Error("SUBMISSION_ALREADY_REVIEWED");

      if (body.status === "APPROVED" && points > 0) {
        const balance = await tx.pointBalance.upsert({
          where: { memberId: sub.memberId },
          create: { memberId: sub.memberId, overpoints: points, socialPoints: points },
          update: { overpoints: { increment: points }, socialPoints: { increment: points } },
        });
        await tx.pointTransaction.create({
          data: {
            memberId: sub.memberId, currency: "OVERPOINTS", category: "social", amount: points,
            balanceAfter: balance.overpoints, source: "SOCIAL_SUBMISSION",
            idempotencyKey: "campaign-" + sub.id,
            reason: "Campaign submission approved: " + sub.campaignId,
            actorId: session?.discordId ?? null,
          },
        });
      }
    });
    await writeAudit(session?.discordId ?? null, "campaign.review." + body.status.toLowerCase(), "CampaignSubmission", sub.id, { points });
    return NextResponse.json({ ok: true, pointsAwarded: points });
  } catch (err) {
    if (err instanceof Error && err.message === "SUBMISSION_ALREADY_REVIEWED") {
      return NextResponse.json({ error: "Submission already reviewed" }, { status: 409 });
    }
    return NextResponse.json({ error: "Unable to review submission" }, { status: 503 });
  }
}
