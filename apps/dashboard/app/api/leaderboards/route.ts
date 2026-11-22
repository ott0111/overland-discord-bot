import { NextResponse } from "next/server";
import { coreApiGet, configuredGuildId } from "../../../lib/core-api";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { session, error } = await requireStaff(req, "analytics.view");
  if (error) return error;
  const guildId = configuredGuildId();
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  const params = new URL(req.url).searchParams;
  const category = params.get("category") || "overall";
  const period = params.get("period") || "LIFETIME";
  const path = "/v1/guilds/" + encodeURIComponent(guildId) + "/leaderboards?actorId=" + encodeURIComponent(session!.discordId) +
    "&category=" + encodeURIComponent(category) + "&period=" + encodeURIComponent(period);
  try { return NextResponse.json(await coreApiGet(path)); }
  catch (err) {
    const status = typeof err === "object" && err !== null && "status" in err ? Number((err as {status?:number}).status) : 503;
    const safeStatus = status >= 400 && status < 600 ? status : 503;
    return NextResponse.json({ error: safeStatus === 503 ? "Leaderboard service unavailable" : err instanceof Error ? err.message : "Request failed" }, { status: safeStatus });
  }
}
