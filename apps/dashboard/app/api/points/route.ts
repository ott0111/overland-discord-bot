import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const memberId = params.get("memberId") ?? undefined;
  const category = params.get("category") ?? undefined;
  try {
    const [transactions, pointValues, dailyLimits] = await Promise.all([
      prisma.pointTransaction.findMany({
        where: {
          ...(memberId ? { memberId } : {}),
          ...(category ? { category } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: 100,
        include: { member: { include: { user: true } } },
      }),
      prisma.botConfiguration.findUnique({ where: { key: "pointValues" } }),
      prisma.botConfiguration.findUnique({ where: { key: "dailyLimits" } }),
    ]);
    return NextResponse.json({
      transactions,
      pointValues: (pointValues?.value as Record<string, unknown>) ?? {},
      dailyLimits: (dailyLimits?.value as Record<string, unknown>) ?? {},
    });
  } catch {
    return NextResponse.json({ transactions: [], pointValues: {}, dailyLimits: [] });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "economy.adjust");
  if (error) return error;
  const body = (await req.json()) as { memberRef?: string; currency?: string; amount?: number; reason?: string };
  if (!body.memberRef || !body.currency || typeof body.amount !== "number" || !Number.isSafeInteger(body.amount) || body.amount === 0 || Math.abs(body.amount) > 1000000000) {
    return NextResponse.json({ error: "memberRef, currency and a non-zero amount are required" }, { status: 400 });
  }
  if (body.currency !== "OVERPOINTS" && body.currency !== "OVERCREDITS") {
    return NextResponse.json({ error: "currency must be OVERPOINTS or OVERCREDITS" }, { status: 400 });
  }
  const amount = body.amount as number;
  try {
    const member = await prisma.discordMember.findFirst({
      where: { OR: [{ id: body.memberRef }, { user: { discordId: body.memberRef } }] },
    });
    if (!member) return NextResponse.json({ error: "Member not found (use Discord ID or member ID)" }, { status: 404 });
    const field = body.currency === "OVERPOINTS" ? "overpoints" : "overcredits";
    const result = await prisma.$transaction(async (tx: never) => {
      const t = tx as unknown as {
        pointBalance: {
          findUnique: (a: unknown) => Promise<{ overpoints: number; overcredits: number } | null>;
          updateMany: (a: unknown) => Promise<{ count: number }>;
          update: (a: unknown) => Promise<{ overpoints: number; overcredits: number }>;
          create: (a: unknown) => Promise<{ overpoints: number; overcredits: number }>;
        };
        pointTransaction: { create: (a: unknown) => Promise<unknown> };
      };
      const existing = await t.pointBalance.findUnique({ where: { memberId: member.id } });
      if (!existing && amount < 0) throw new Error("NEGATIVE_BALANCE");
      let bal: { overpoints: number; overcredits: number };
      if (existing) {
        const guard = await t.pointBalance.updateMany({
          where: { memberId: member.id, ...(amount < 0 ? { [field]: { gte: -amount } } : {}) },
          data: { [field]: { increment: amount } },
        });
        if (guard.count !== 1) throw new Error("NEGATIVE_BALANCE");
        bal = await t.pointBalance.findUnique({ where: { memberId: member.id } }) as { overpoints: number; overcredits: number };
      } else {
        bal = await t.pointBalance.create({ data: { memberId: member.id, [field]: amount } });
      }
      const after = (bal as unknown as Record<string, number>)[field];
      await t.pointTransaction.create({
        data: {
          memberId: member.id, currency: body.currency as never, category: "admin", amount,
          balanceAfter: after, source: "ADMIN_ADJUSTMENT",
          idempotencyKey: "admin-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
          reason: body.reason ?? "Admin adjustment",
          actorId: session?.discordId ?? null,
        },
      });
      return bal;
    });
    await writeAudit(session?.discordId ?? null, "economy.adjust", "PointBalance", member.id, {
      currency: body.currency, amount, reason: body.reason ?? null,
    });
    return NextResponse.json({ ok: true, balance: result });
  } catch (e) {
    if (e instanceof Error && e.message === "NEGATIVE_BALANCE") {
      return NextResponse.json({ error: "Adjustment would make the balance negative" }, { status: 400 });
    }
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
