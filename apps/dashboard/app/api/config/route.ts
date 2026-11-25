import { NextResponse } from "next/server";
import { coreApiGet, coreApiPost, configuredGuildId } from "../../../lib/core-api";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: number }).status) : 503;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Configuration service unavailable" }, { status: status >= 400 && status < 600 ? status : 503 });
}

export async function GET(req: Request) {
  const { session, error } = await requireStaff(req, "config.manage");
  if (error) return error;
  const guildId = configuredGuildId();
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  try {
    return NextResponse.json(await coreApiGet("/v1/guilds/" + encodeURIComponent(guildId) + "/config?actorId=" + encodeURIComponent(session!.discordId)));
  } catch (err) { return failure(err); }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "config.manage");
  if (error) return error;
  const guildId = configuredGuildId();
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  const body = await req.json().catch(() => null) as { key?: string; value?: unknown } | null;
  if (!body || typeof body.key !== "string" || !body.key.trim()) return NextResponse.json({ error: "key is required" }, { status: 400 });
  try {
    return NextResponse.json(await coreApiPost("/v1/guilds/" + encodeURIComponent(guildId) + "/config", { ...body, actorId: session!.discordId }));
  } catch (err) { return failure(err); }
}
