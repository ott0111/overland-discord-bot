import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

const GROUP_NAME_MAP: Record<string, string> = {
  "Owner": "Owner",
  "Executive": "Executive",
  "Administration": "Administration",
  "Moderation": "Moderation",
  "Development": "Development",
  "Support": "Support",
  "Rewards Management": "Rewards_Management",
  "Rewards_Management": "Rewards_Management",
};

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  try {
    const team = await prisma.internalTeamMember.findMany({
      orderBy: { addedAt: "asc" },
      include: { group: { include: { permissions: true } }, member: { include: { user: true } } },
    });
    return NextResponse.json(team);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "team.manage");
  if (error) return error;
  const body = (await req.json()) as {
    discordId?: string; username?: string; publicRole?: string; jobTitle?: string;
    department?: string; responsibilities?: string; groupName?: string;
  };
  if (!body.discordId || !body.username || !body.jobTitle || !body.department || !body.groupName) {
    return NextResponse.json({ error: "discordId, username, jobTitle, department and groupName are required" }, { status: 400 });
  }
  const groupName = GROUP_NAME_MAP[body.groupName];
  if (!groupName) return NextResponse.json({ error: "Unknown permission group: " + body.groupName }, { status: 400 });
  try {
    const group = await prisma.permissionGroup.findUnique({ where: { name: groupName as never } });
    if (!group) return NextResponse.json({ error: "Permission group not seeded yet" }, { status: 400 });
    const user = await prisma.user.upsert({
      where: { discordId: body.discordId },
      update: { username: body.username },
      create: { discordId: body.discordId, username: body.username },
    });
    const member = await prisma.discordMember.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, guildId: process.env.DISCORD_GUILD_ID ?? process.env.GUILD_ID ?? "unconfigured" },
    });
    const record = await prisma.internalTeamMember.create({
      data: {
        memberId: member.id,
        discordId: body.discordId,
        username: body.username,
        publicRole: body.publicRole ?? body.jobTitle,
        jobTitle: body.jobTitle,
        department: body.department,
        responsibilities: body.responsibilities ?? null,
        groupId: group.id,
      },
    });
    await writeAudit(session?.discordId ?? null, "team.add", "InternalTeamMember", record.id, { username: body.username, groupName });
    return NextResponse.json(record, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database unavailable or staff record already exists" }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await requireStaff(req, "team.manage");
  if (error) return error;
  const body = (await req.json()) as {
    id?: string; jobTitle?: string; department?: string; responsibilities?: string | null;
    publicRole?: string; status?: string; groupId?: string;
  };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const record = await prisma.internalTeamMember.update({
      where: { id: body.id },
      data: {
        ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle } : {}),
        ...(body.department !== undefined ? { department: body.department } : {}),
        ...(body.responsibilities !== undefined ? { responsibilities: body.responsibilities } : {}),
        ...(body.publicRole !== undefined ? { publicRole: body.publicRole } : {}),
        ...(body.status !== undefined ? { status: body.status as never } : {}),
        ...(body.groupId !== undefined ? { groupId: body.groupId } : {}),
      },
    });
    await writeAudit(session?.discordId ?? null, "team.update", "InternalTeamMember", record.id, { username: record.username });
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ error: "Database unavailable or record not found" }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const { session, error } = await requireStaff(req, "team.manage");
  if (error) return error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    await prisma.internalTeamMember.delete({ where: { id } });
    await writeAudit(session?.discordId ?? null, "team.remove", "InternalTeamMember", id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Database unavailable or record not found" }, { status: 503 });
  }
}
