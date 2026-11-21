import { NextResponse } from "next/server";
import { requireStaff } from "../../../lib/auth";
import { coreApiGet, configuredGuildId } from "../../../lib/core-api";
export const dynamic = "force-dynamic";

interface AuditRow {
  id: string;
  actorId: string | null;
  action: string;
  entityType: string | null;
  createdAt: string;
}

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "audit.view");
  if (error) return error;
  const guildId = configuredGuildId();
  if (!guildId) return NextResponse.json({ error: "DISCORD_GUILD_ID is not configured" }, { status: 503 });
  const params = new URL(req.url).searchParams;
  const take = Math.min(200, Math.max(1, Number(params.get("take") ?? "100") || 100));
  try {
    const rows = await coreApiGet<AuditRow[]>(
      "/v1/guilds/" + encodeURIComponent(guildId) + "/audit?take=" + take,
    );
    return NextResponse.json(rows, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Overland bot API unavailable" },
      { status: 503 },
    );
  }
}
