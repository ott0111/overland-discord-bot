import { NextResponse } from "next/server";
import { requireStaff } from "../../../lib/auth";
import { coreApiGet, configuredGuildId } from "../../../lib/core-api";
export const dynamic = "force-dynamic";

interface Overview {
  members: number;
  openTickets: number;
  pendingClaims: number;
  pendingSubmissions: number;
  pointsToday: number;
  checkinsToday: number;
  joinsToday: number;
  pointsByCategory: { category: string; total: number }[];
  daily: { date: string; checkins: number; joins: number; points: number }[];
  db: string;
}

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "analytics.view");
  if (error) return error;
  const guildId = configuredGuildId();
  if (!guildId) return NextResponse.json({ error: "DISCORD_GUILD_ID is not configured" }, { status: 503 });
  try {
    const data = await coreApiGet<Overview>("/v1/guilds/" + encodeURIComponent(guildId) + "/overview");
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Overland bot API unavailable" },
      { status: 503 },
    );
  }
}
