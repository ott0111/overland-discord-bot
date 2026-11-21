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
    return NextResponse.json({ campaigns: [], submissions: [] });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "campaigns.manage");
  if (error) return error;
  const body = (await req.json()) as {
    name?: string; description?: string; objectives?: string; startsAt?: string; endsAt?: string;
    pointReward?: number; submissionRequirements?: string; tasks?: string; status?: string;
  };
  if (!body.name || !body.description || !body.startsAt || !body.endsAt) {
    return NextResponse.json({ error: "name, description, startsAt and endsAt are required" }, { status: 400 });
  }
  try {
    const campaign = await prisma.campaign.create({
      data: {
        name: body.name,
        description: body.description,
        objectives: body.objectives ?? null,
        startsAt: new Date(body.startsAt),
        endsAt: new Date(body.endsAt),
        pointReward: body.pointReward ?? 0,
        submissionRequirements: body.submissionRequirements ?? null,
        tasks: body.tasks ? body.tasks.split("\n").map((t) => t.trim()).filter(Boolean) : [],
        status: (body.status as never) ?? "DRAFT",
        createdBy: session?.discordId ?? null,
      },
    });
    await writeAudit(session?.discordId ?? null, "campaign.create", "Campaign", campaign.id, { name: body.name });
    return NextResponse.json(campaign, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await requireStaff(req, "campaigns.review");
  if (error) return error;
  const body = (await req.json()) as { submissionId?: string; status?: string; feedback?: string; pointsAwarded?: number };
  if (!body.submissionId || !body.status) return NextResponse.json({ error: "submissionId and status are required" }, { status: 400 });
  if (body.status !== "APPROVED" && body.status !== "REJECTED") {
    return NextResponse.json({ error: "status must be APPROVED or REJECTED" }, { status: 400 });
  }
  try {
    const sub = await prisma.campaignSubmission.findUnique({ where: { id: body.submissionId } });
    if (!sub) return NextResponse.json({ error: "Submission not found" }, { status: 404 });
    if (sub.status !== "PENDING") return NextResponse.json({ error: "Submission already reviewed" }, { status: 409 });
    const points = body.status === "APPROVED" ? Math.max(0, body.pointsAwarded ?? sub.pointsAwarded ?? 0) : 0;
    if (body.status === "APPROVED" && points > 0) {
      // Atomic award: balance update, transaction and review land together.
      // The idempotency key makes a duplicate review fail instead of double paying.
      await prisma.$transaction(async (tx: never) => {
        const t = tx as unknown as {
          pointBalance: { upsert: (a: unknown) => Promise<{ overpoints: number }> };
          pointTransaction: { create: (a: unknown) => Promise<unknown> };
          campaignSubmission: { update: (a: unknown) => Promise<unknown> };
        };
        const bal = await t.pointBalance.upsert({
          where: { memberId: sub.memberId },
          create: { memberId: sub.memberId, overpoints: points, socialPoints: points },
          update: { overpoints: { increment: points }, socialPoints: { increment: points } },
        });
        await t.pointTransaction.create({
          data: {
            memberId: sub.memberId, currency: "OVERPOINTS", category: "social", amount: points,
            balanceAfter: bal.overpoints, source: "SOCIAL_SUBMISSION",
            idempotencyKey: "campaign-" + sub.id,
            reason: "Campaign submission approved: " + sub.campaignId,
            actorId: session?.discordId ?? null,
          },
        });
        await t.campaignSubmission.update({
          where: { id: sub.id },
          data: { status: "APPROVED", feedback: body.feedback ?? null, pointsAwarded: points, reviewedBy: session?.discordId ?? null, reviewedAt: new Date() },
        });
      });
    } else {
      await prisma.campaignSubmission.update({
        where: { id: sub.id },
        data: { status: body.status as never, feedback: body.feedback ?? null, pointsAwarded: 0, reviewedBy: session?.discordId ?? null, reviewedAt: new Date() },
      });
    }
    await writeAudit(session?.discordId ?? null, "campaign.review." + body.status.toLowerCase(), "CampaignSubmission", sub.id, { points });
    return NextResponse.json({ ok: true, pointsAwarded: points });
  } catch {
    return NextResponse.json({ error: "Database unavailable or submission already paid" }, { status: 503 });
  }
}
