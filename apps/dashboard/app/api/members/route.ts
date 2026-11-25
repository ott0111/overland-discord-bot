import { NextResponse } from "next/server";
import { coreApiGet, configuredGuildId } from "../../../lib/core-api";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { session, error } = await requireStaff(req, "economy.view");
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const guildId = configuredGuildId();
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  const q = (params.get("q") ?? "").trim().slice(0, 100);
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? "20") || 20));
  const path = "/v1/guilds/" + encodeURIComponent(guildId) + "/members?actorId=" + encodeURIComponent(session!.discordId) +
    "&q=" + encodeURIComponent(q) + "&page=" + page + "&limit=" + limit;
  try {
    return NextResponse.json(await coreApiGet(path));
  } catch (err) {
    const status = typeof err === "object" && err !== null && "status" in err ? Number((err as {status?:number}).status) : 503;
    return NextResponse.json({ error: status === 503 ? "Member service unavailable" : err instanceof Error ? err.message : "Request failed" }, { status: status >= 400 && status < 600 ? status : 503 });
  }
}
