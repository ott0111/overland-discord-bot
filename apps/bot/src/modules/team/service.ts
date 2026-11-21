import { prisma, audit } from "../../lib/db.js";
import { hasPermission, isStaff } from "../../lib/permissions.js";

export { hasPermission, isStaff } from "../../lib/permissions.js";

/** Map the dashboard-facing group label to the Prisma enum value. */
export function normalizeGroupName(name: string): string {
  if (name === "Rewards Management") return "Rewards_Management";
  return name;
}

export const GROUP_NAMES = [
  "Owner",
  "Executive",
  "Administration",
  "Moderation",
  "Development",
  "Support",
  "Rewards_Management",
] as const;

/** Founder (Owner group) only for team membership changes. */
async function requireTeamManage(actorDiscordId: string): Promise<void> {
  if (!(await hasPermission(actorDiscordId, "team.manage"))) {
    throw new Error("You do not have permission to manage the internal team");
  }
}

async function resolveMember(discordId: string, username: string) {
  const user = await prisma.user.upsert({
    where: { discordId },
    update: { username },
    create: { discordId, username },
  });
  return prisma.discordMember.upsert({
    where: { userId: user.id },
    update: {},
    create: { userId: user.id, guildId: process.env.DISCORD_GUILD_ID ?? "" },
  });
}

export interface AddTeamMemberInput {
  discordId: string;
  username: string;
  publicRole: string;
  jobTitle: string;
  department: string;
  groupName: string;
  responsibilities?: string;
}

/**
 * Add a staff member. Creates the underlying User/DiscordMember records
 * if needed, resolves the permission group, and records the addition in
 * the audit log. Internal records are never exposed to ordinary members:
 * only team.view / team.manage holders can read them (enforced by the
 * dashboard and by listTeam/getTeamMember here).
 */
export async function addTeamMember(actorDiscordId: string, input: AddTeamMemberInput) {
  await requireTeamManage(actorDiscordId);
  const group = await prisma.permissionGroup.findUnique({ where: { name: normalizeGroupName(input.groupName) as never } });
  if (!group) throw new Error(`Permission group not found: ${input.groupName}`);
  const existing = await prisma.internalTeamMember.findUnique({ where: { discordId: input.discordId } });
  if (existing && existing.status === "ACTIVE") throw new Error("That member is already on the internal team");
  const member = await resolveMember(input.discordId, input.username);
  const record = await prisma.internalTeamMember.upsert({
    where: { discordId: input.discordId },
    update: {
      username: input.username,
      publicRole: input.publicRole,
      jobTitle: input.jobTitle,
      department: input.department,
      responsibilities: input.responsibilities,
      groupId: group.id,
      status: "ACTIVE",
    },
    create: {
      memberId: member.id,
      discordId: input.discordId,
      username: input.username,
      publicRole: input.publicRole,
      jobTitle: input.jobTitle,
      department: input.department,
      responsibilities: input.responsibilities,
      groupId: group.id,
      status: "ACTIVE",
    },
  });
  await audit(actorDiscordId, "team.add", "InternalTeamMember", record.id, {
    discordId: input.discordId,
    jobTitle: input.jobTitle,
    groupName: input.groupName,
  });
  return record;
}

export interface UpdateTeamMemberInput {
  publicRole?: string;
  jobTitle?: string;
  department?: string;
  responsibilities?: string | null;
  groupName?: string;
  status?: "ACTIVE" | "INACTIVE" | "SUSPENDED" | "REMOVED";
}

export async function updateTeamMember(actorDiscordId: string, discordId: string, input: UpdateTeamMemberInput) {
  await requireTeamManage(actorDiscordId);
  const data: Record<string, unknown> = {};
  if (input.publicRole !== undefined) data.publicRole = input.publicRole;
  if (input.jobTitle !== undefined) data.jobTitle = input.jobTitle;
  if (input.department !== undefined) data.department = input.department;
  if (input.responsibilities !== undefined) data.responsibilities = input.responsibilities;
  if (input.status !== undefined) data.status = input.status as never;
  if (input.groupName) {
    const group = await prisma.permissionGroup.findUnique({ where: { name: normalizeGroupName(input.groupName) as never } });
    if (!group) throw new Error(`Permission group not found: ${input.groupName}`);
    data.groupId = group.id;
  }
  const record = await prisma.internalTeamMember.update({ where: { discordId }, data });
  await audit(actorDiscordId, "team.update", "InternalTeamMember", record.id, { discordId, ...input });
  return record;
}

/**
 * Remove a staff member. The record is kept with status REMOVED (never
 * hard deleted) so past actions stay attributable in the audit log.
 */
export async function removeTeamMember(actorDiscordId: string, discordId: string, reason?: string) {
  await requireTeamManage(actorDiscordId);
  const record = await prisma.internalTeamMember.update({
    where: { discordId },
    data: { status: "REMOVED" },
  });
  await audit(actorDiscordId, "team.remove", "InternalTeamMember", record.id, { discordId, reason });
  return record;
}

/** Staff list, newest first. Caller must already hold team.view. */
export async function listTeam(requesterDiscordId: string, includeRemoved = false) {
  if (!(await hasPermission(requesterDiscordId, "team.view"))) {
    throw new Error("You do not have permission to view the internal team");
  }
  return prisma.internalTeamMember.findMany({
    where: includeRemoved ? {} : { status: { not: "REMOVED" as never } },
    orderBy: { addedAt: "desc" },
    include: { group: { include: { permissions: true } } },
  });
}

export async function getTeamMember(requesterDiscordId: string, discordId: string) {
  if (!(await hasPermission(requesterDiscordId, "team.view"))) {
    throw new Error("You do not have permission to view the internal team");
  }
  const record = await prisma.internalTeamMember.findUnique({
    where: { discordId },
    include: { group: { include: { permissions: true } }, member: { include: { user: true } } },
  });
  if (!record) throw new Error("Team member not found");
  return record;
}

/** Every permission key a staff member currently holds. */
export async function listPermissionsFor(discordId: string): Promise<string[]> {
  const record = await prisma.internalTeamMember.findUnique({
    where: { discordId },
    include: { group: { include: { permissions: true } } },
  });
  if (!record || record.status !== "ACTIVE") return [];
  if (record.group.name === "Owner") {
    const all = await prisma.permission.findMany({ select: { key: true } });
    return all.map((p: { key: string }) => p.key);
  }
  return record.group.permissions.map((p: { key: string }) => p.key);
}

/**
 * Real DB-backed permission check: InternalTeamMember -> PermissionGroup
 * -> Permission, with the Owner group bypassing all checks. Re-exported
 * from lib/permissions so callers can import from either place.
 */
export async function requirePermission(discordId: string, permissionKey: string): Promise<void> {
  if (!(await hasPermission(discordId, permissionKey))) {
    throw new Error(`Permission denied: ${permissionKey} is required`);
  }
}

/** True when the Discord user is an active staff member. */
export async function isTeamMember(discordId: string): Promise<boolean> {
  return isStaff(discordId);
}
