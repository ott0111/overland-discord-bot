import { NextResponse } from "next/server";
import { coreApiGet, coreApiPost, configuredGuildId } from "../../../lib/core-api";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

function guildOrError() {
  const guildId = configuredGuildId();
  if (!/^\\d{17,20}$/.test(guildId)) {
    return { guildId: "", error: NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 }) };
  }
  return { guildId, error: null };
}

function failure(err: unknown) {
  const status = typeof err === "object" && err !== null && "status" in err
    ? Number((err as { status?: number }).status) : 503;
  return NextResponse.json(
    { error: err instanceof Error ? err.message : "Achievement service unavailable" },
    { status: status >= 400 && status < 600 ? status : 503 },
  );
}

export async function GET(req: Request) {
  const { session, error } = await requireStaff(req, "achievements.manage");
  if (error) return error;
  const { guildId, error: configError } = guildOrError();
  if (configError) return configError;
  try {
    const path = "/v1/guilds/" + encodeURIComponent(guildId) + "/achievements?actorId=" + encodeURIComponent(session!.discordId);
    return NextResponse.json(await coreApiGet(path));
  } catch (err) {
    return failure(err);
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "achievements.manage");
  if (error) return error;
  const { guildId, error: configError } = guildOrError();
  if (configError) return configError;
  const body = await req.json().catch(() => null) as Record<string, unknown> | null;
  if (!body || typeof body.name !== "string" || !body.name.trim() || typeof body.description !== "string" || !body.description.trim()) {
    return NextResponse.json({ error: "name and description are required" }, { status: 400 });
  }
  try {
    const achievement = await coreApiPost("/v1/guilds/" + encodeURIComponent(guildId) + "/achievements", {
      ...body, actorId: session!.discordId,
    });
    return NextResponse.json(achievement, { status: 201 });
  } catch (err) {
    return failure(err);
  }
}
