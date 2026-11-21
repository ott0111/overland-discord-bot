import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

async function readXConfig(): Promise<Record<string, unknown>> {
  try {
    const row = await prisma.botConfiguration.findUnique({ where: { key: "xIntegration" } });
    return (row?.value as Record<string, unknown>) ?? {};
  } catch {
    return {};
  }
}

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "x.manage");
  if (error) return error;
  try {
    const [config, posts] = await Promise.all([
      readXConfig(),
      prisma.xPost.findMany({ orderBy: { createdAt: "desc" }, take: 30 }),
    ]);
    return NextResponse.json({ config, posts });
  } catch {
    return NextResponse.json({ config: {}, posts: [], db: "unavailable" });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "x.manage");
  if (error) return error;
  const body = (await req.json()) as { action?: string; value?: Record<string, unknown>; text?: string; url?: string };
  try {
    if (body.action === "config") {
      const merged = { ...(await readXConfig()), ...(body.value ?? {}) };
      const row = await prisma.botConfiguration.upsert({
        where: { key: "xIntegration" },
        update: { value: merged as never, updatedBy: session?.discordId ?? null },
        create: { key: "xIntegration", value: merged as never, updatedBy: session?.discordId ?? null },
      });
      await writeAudit(session?.discordId ?? null, "x.config", "BotConfiguration", row.id);
      return NextResponse.json(row);
    }
    if (body.action === "announce") {
      if (!body.text || !body.url) return NextResponse.json({ error: "text and url are required" }, { status: 400 });
      const config = await readXConfig();
      // Recorded as a manual announcement. The bot posts it to Discord from
      // this record; this route never claims a live post was published.
      const post = await prisma.xPost.create({
        data: {
          postId: "manual-" + Date.now(),
          authorUsername: String(config.username ?? "OverlandFinance"),
          text: body.text,
          url: body.url,
          announcedChannelId: (config.announcementChannelId as string | undefined) ?? null,
        },
      });
      await writeAudit(session?.discordId ?? null, "x.manual_announce", "XPost", post.id, { url: body.url });
      return NextResponse.json(post, { status: 201 });
    }
    return NextResponse.json({ error: "Unknown action" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
