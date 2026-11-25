import { NextResponse } from "next/server";
import { coreApiGet, configuredGuildId } from "../../../lib/core-api";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { session, error } = await requireStaff(req, "referrals.view");
  if (error) return error;
  const guildId = configuredGuildId();
  if (!/^\\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  try {
    const path = "/v1/guilds/" + encodeURIComponent(guildId) + "/referrals?actorId=" + encodeURIComponent(session!.discordId);
    return NextResponse.json(await coreApiGet(path));
  } catch (err) {
    const status = typeof err === "object" && err !== null && "status" in err ? Number((err as { status?: number }).status) : 503;
    return NextResponse.json({ error: err instanceof Error ? err.message : "Referral service unavailable" }, { status: status >= 400 && status < 600 ? status : 503 });
  }
}
