import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "config.manage");
  if (error) return error;
  try {
    return NextResponse.json(await prisma.botConfiguration.findMany({ orderBy: { key: "asc" } }));
  } catch {
    return NextResponse.json([]);
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "config.manage");
  if (error) return error;
  const body = (await req.json()) as { key: string; value: unknown };
  if (!body.key) return NextResponse.json({ error: "key is required" }, { status: 400 });
  try {
    const row = await prisma.botConfiguration.upsert({
      where: { key: body.key },
      update: { value: body.value as never, updatedBy: session?.discordId ?? null },
      create: { key: body.key, value: body.value as never, updatedBy: session?.discordId ?? null },
    });
    await writeAudit(session?.discordId ?? null, "config.update", "BotConfiguration", row.id, { key: body.key });
    return NextResponse.json(row);
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
