import { NextResponse } from "next/server";
import { PERMISSIONS } from "@overland/shared";
import { coreApiGet, coreApiPost, configuredGuildId } from "../../../lib/core-api";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

function failure(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: number }).status) : 503;
  return NextResponse.json({ error: error instanceof Error ? error.message : "Permission service unavailable" }, { status: status >= 400 && status < 600 ? status : 503 });
}

export async function GET(req: Request) {
  const { session, error } = await requireStaff(req, "team.view");
  if (error) return error;
  const guildId = configuredGuildId();
  if (!/^\\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  try {
    const data = await coreApiGet<{ groups: unknown[] }>("/v1/guilds/" + encodeURIComponent(guildId) + "/permissions?actorId=" + encodeURIComponent(session!.discordId));
    return NextResponse.json({ ...data, allKeys: [...PERMISSIONS] });
  } catch (err) { return failure(err); }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "team.view");
  if (error) return error;
  if (session?.group !== "Owner") return NextResponse.json({ error: "Only an Owner can change permission group definitions" }, { status: 403 });
  const guildId = configuredGuildId();
  if (!/^\\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  const body = await req.json().catch(() => null) as { groupId?: string; keys?: string[] } | null;
  if (!body?.groupId || !Array.isArray(body.keys)) return NextResponse.json({ error: "groupId and keys[] are required" }, { status: 400 });
  try {
    return NextResponse.json(await coreApiPost("/v1/guilds/" + encodeURIComponent(guildId) + "/permissions", { ...body, actorId: session!.discordId }));
  } catch (err) { return failure(err); }
}
