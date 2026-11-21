import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "tickets.view");
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const id = params.get("id") ?? undefined;
  const status = params.get("status") ?? undefined;
  try {
    if (id) {
      const ticket = await prisma.ticket.findUnique({
        where: { id },
        include: { member: { include: { user: true } }, messages: { orderBy: { createdAt: "asc" } } },
      });
      if (!ticket) return NextResponse.json({ error: "Ticket not found" }, { status: 404 });
      return NextResponse.json(ticket);
    }
    const tickets = await prisma.ticket.findMany({
      where: status ? { status: status as never } : undefined,
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { member: { include: { user: true } }, _count: { select: { messages: true } } },
    });
    return NextResponse.json(tickets);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await requireStaff(req, "tickets.manage");
  if (error) return error;
  const body = (await req.json()) as { id?: string; action?: string; rating?: number };
  if (!body.id || !body.action) return NextResponse.json({ error: "id and action are required" }, { status: 400 });
  try {
    let data: Record<string, unknown> = {};
    if (body.action === "claim") data = { status: "CLAIMED", claimedBy: session?.discordId ?? null, firstResponseAt: new Date() };
    else if (body.action === "close") data = { status: "CLOSED", closedAt: new Date() };
    else if (body.action === "reopen") data = { status: "OPEN", closedAt: null };
    else if (body.action === "archive") data = { status: "ARCHIVED" };
    else if (body.action === "rate" && typeof body.rating === "number") data = { rating: Math.max(1, Math.min(5, body.rating)) };
    else return NextResponse.json({ error: "Unknown action" }, { status: 400 });
    const ticket = await prisma.ticket.update({ where: { id: body.id }, data: data as never });
    await writeAudit(session?.discordId ?? null, "ticket." + body.action, "Ticket", ticket.id, { number: ticket.number });
    return NextResponse.json(ticket);
  } catch {
    return NextResponse.json({ error: "Database unavailable or ticket not found" }, { status: 503 });
  }
}
