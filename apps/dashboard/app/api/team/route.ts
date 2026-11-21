import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

const GROUP_NAME_MAP: Record<string, string> = {
  Owner: "Owner", Executive: "Executive", Administration: "Administration",
  Moderation: "Moderation", Development: "Development", Support: "Support",
  "Rewards Management": "Rewards_Management", Rewards_Management: "Rewards_Management",
};

async function activeOwnerCount(): Promise<number> {
  return prisma.internalTeamMember.count({
    where: { status: "ACTIVE", group: { name: "Owner" } },
  });
}

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
    return NextResponse.json({ error: "Unable to load team records" }, { status: 503 });
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
    const group = await prisma.permissionGroup.findUnique({ where: { name: groupName as never } });
    if (!group) return NextResponse.json({ error: "Permission group has not been seeded" }, { status: 400 });
    const user = await prisma.user.upsert({
      where: { discordId: body.discordId },
      update: { username: body.username.trim() },
      create: { discordId: body.discordId, username: body.username.trim() },
    });
    const member = await prisma.discordMember.upsert({
      where: { userId: user.id },
      update: {},
      create: { userId: user.id, guildId: process.env.DISCORD_GUILD_ID ?? process.env.GUILD_ID ?? "unconfigured" },
    });
    const record = await prisma.internalTeamMember.create({
      data: {
        memberId: member.id, discordId: body.discordId, username: body.username.trim(),
        publicRole: body.publicRole?.trim() || body.jobTitle.trim(),
        jobTitle: body.jobTitle.trim(), department: body.department.trim(),
        responsibilities: body.responsibilities?.trim() || null, groupId: group.id,
      },
    });
    await writeAudit(session?.discordId ?? null, "team.add", "InternalTeamMember", record.id, { username: record.username, groupName });
    return NextResponse.json(record, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Team member already exists or the database is unavailable" }, { status: 409 });
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
    const existing = await prisma.internalTeamMember.findUnique({ where: { id: body.id }, include: { group: true } });
    if (!existing) return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    const actorIsOwner = session?.group === "Owner";
    if (existing.group.name === "Owner" && !actorIsOwner) {
      return NextResponse.json({ error: "Only an Owner can modify another Owner" }, { status: 403 });
    }
    if (body.groupId) {
      const targetGroup = await prisma.permissionGroup.findUnique({ where: { id: body.groupId } });
      if (!targetGroup) return NextResponse.json({ error: "Permission group not found" }, { status: 400 });
      if (targetGroup.name === "Owner" && !actorIsOwner) {
        return NextResponse.json({ error: "Only an existing Owner can appoint another Owner" }, { status: 403 });
      }
    }
    const leavingOwner = existing.group.name === "Owner" &&
      ((body.groupId !== undefined && body.groupId !== existing.groupId) || (body.status !== undefined && body.status !== "ACTIVE"));
    if (leavingOwner && await activeOwnerCount() <= 1) {
      return NextResponse.json({ error: "The last active Owner cannot be demoted or removed" }, { status: 409 });
    }
    const record = await prisma.internalTeamMember.update({
      where: { id: body.id },
      data: {
        ...(body.jobTitle !== undefined ? { jobTitle: body.jobTitle.trim() } : {}),
        ...(body.department !== undefined ? { department: body.department.trim() } : {}),
        ...(body.responsibilities !== undefined ? { responsibilities: body.responsibilities } : {}),
        ...(body.publicRole !== undefined ? { publicRole: body.publicRole.trim() } : {}),
        ...(body.status !== undefined ? { status: body.status as never } : {}),
        ...(body.groupId !== undefined ? { groupId: body.groupId } : {}),
      },
    });
    await writeAudit(session?.discordId ?? null, "team.update", "InternalTeamMember", record.id, { username: record.username });
    return NextResponse.json(record);
  } catch {
    return NextResponse.json({ error: "Unable to update team member" }, { status: 503 });
  }
}

export async function DELETE(req: Request) {
  const { session, error } = await requireStaff(req, "team.manage");
  if (error) return error;
  const id = new URL(req.url).searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const existing = await prisma.internalTeamMember.findUnique({ where: { id }, include: { group: true } });
    if (!existing) return NextResponse.json({ error: "Team member not found" }, { status: 404 });
    if (existing.group.name === "Owner" && session?.group !== "Owner") {
      return NextResponse.json({ error: "Only an Owner can remove another Owner" }, { status: 403 });
    }
    if (existing.group.name === "Owner" && existing.status === "ACTIVE" && await activeOwnerCount() <= 1) {
      return NextResponse.json({ error: "The last active Owner cannot be removed" }, { status: 409 });
    }
    await prisma.internalTeamMember.delete({ where: { id } });
    await writeAudit(session?.discordId ?? null, "team.remove", "InternalTeamMember", id, { username: existing.username });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Unable to remove team member" }, { status: 503 });
  }
}
