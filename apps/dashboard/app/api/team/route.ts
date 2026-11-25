import { NextResponse } from "next/server";
import { coreApiDelete, coreApiGet, coreApiPatch, coreApiPost, configuredGuildId } from "../../../lib/core-api";
import { requireStaff } from "../../../lib/auth";

export const dynamic = "force-dynamic";

const GROUP_NAME_MAP: Record<string, string> = {
  Owner: "Owner", Executive: "Executive", Administration: "Administration",
  Moderation: "Moderation", Development: "Development", Support: "Support",
  "Rewards Management": "Rewards_Management", Rewards_Management: "Rewards_Management",
};

function guildPath(): string {
  const guildId = configuredGuildId();
  if (!/^\d{17,20}$/.test(guildId)) throw new Error("Discord guild is not configured");
  return "/v1/guilds/" + encodeURIComponent(guildId) + "/team";
}

function apiError(error: unknown, fallback: string) {
  const status = typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status?: number }).status) : 503;
  const safeStatus = status >= 400 && status < 600 ? status : 503;
  const message = error instanceof Error && safeStatus !== 503 ? error.message : fallback;
  return NextResponse.json({ error: message }, { status: safeStatus });
}

export async function GET(req: Request) {
  const { session, error } = await requireStaff(req, "team.view");
  if (error) return error;
  try {
    const path = guildPath() + "?actorId=" + encodeURIComponent(session!.discordId);
    return NextResponse.json(await coreApiGet(path));
  } catch (err) {
    return apiError(err, "Unable to load team records");
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "team.manage");
  if (error) return error;
  let body: {
    discordId?: string; username?: string; publicRole?: string; jobTitle?: string;
    department?: string; responsibilities?: string; groupName?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.discordId || !/^\d{17,20}$/.test(body.discordId) || !body.username?.trim() ||
      !body.jobTitle?.trim() || !body.department?.trim() || !body.groupName) {
    return NextResponse.json({ error: "A valid Discord ID, username, job title, department and group are required" }, { status: 400 });
  }
  const groupName = GROUP_NAME_MAP[body.groupName];
  if (!groupName) return NextResponse.json({ error: "Unknown permission group" }, { status: 400 });
  if (groupName === "Owner" && session?.group !== "Owner") {
    return NextResponse.json({ error: "Only an existing Owner can appoint another Owner" }, { status: 403 });
  }
  try {
    const record = await coreApiPost(guildPath(), { ...body, groupName, actorId: session!.discordId });
    return NextResponse.json(record, { status: 201 });
  } catch (err) {
    return apiError(err, "Unable to add team member");
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await requireStaff(req, "team.manage");
  if (error) return error;
  let body: {
    id?: string; jobTitle?: string; department?: string; responsibilities?: string | null;
    publicRole?: string; status?: string; groupId?: string;
  };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (body.status && !["ACTIVE", "INACTIVE", "SUSPENDED", "REMOVED"].includes(body.status)) {
    return NextResponse.json({ error: "Invalid team status" }, { status: 400 });
  }
  try {
    return NextResponse.json(await coreApiPatch(guildPath(), { ...body, actorId: session!.discordId }));
  } catch (err) {
    return apiError(err, "Unable to update team member");
  }
}

export async function DELETE(req: Request) {
  const { session, error } = await requireStaff(req, "team.manage");
  if (error) return error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const path = guildPath() + "?id=" + encodeURIComponent(id) + "&actorId=" + encodeURIComponent(session!.discordId);
    return NextResponse.json(await coreApiDelete(path));
  } catch (err) {
    return apiError(err, "Unable to remove team member");
  }
}
