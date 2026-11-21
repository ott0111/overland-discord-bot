import type { Guild } from "discord.js";
import { prisma, audit } from "../../lib/db.js";
import { getConfig } from "../../lib/config.js";
import { hasPermission } from "../../lib/permissions.js";
import { checkComradeConversion } from "../referrals/service.js";

export async function grantRole(memberId: string, roleName: string, actorId: string, reason?: string) {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) throw new Error(`Role not found: ${roleName}`);
  if (role.isInternal) throw new Error("Internal roles are assigned only through Internal Team management, not this path");
  if (role.requiresRoleId) {
    const has = await prisma.memberRole.findUnique({ where: { memberId_roleId: { memberId, roleId: role.requiresRoleId } } });
    if (!has) throw new Error(`Role ${roleName} requires the prerequisite role first`);
  }
  await prisma.$transaction([
    prisma.memberRole.upsert({ where: { memberId_roleId: { memberId, roleId: role.id } }, update: {}, create: { memberId, roleId: role.id, grantedBy: actorId } }),
    prisma.roleHistory.create({ data: { memberId, roleId: role.id, action: "GRANT", actorId, reason } }),
  ]);
  await audit(actorId, "roles.grant", "Role", role.id, { memberId, roleName });
}

/** Pure requirement check, unit tested. */
export function meetsRoleRequirements(memberRoleNames: string[], requiredRole: string | null, minOverpoints: number | null, overpoints: number): boolean {
  if (requiredRole && !memberRoleNames.includes(requiredRole)) return false;
  if (minOverpoints !== null && overpoints < minOverpoints) return false;
  return true;
}

export async function revokeRole(memberId: string, roleName: string, actorId: string, reason?: string): Promise<string[]> {
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role) throw new Error("Role not found: " + roleName);
  if (role.isInternal) throw new Error("Internal team positions are managed through Internal Team management");

  // Removing a prerequisite also removes any held roles that depend on it,
  // recursively. For example, removing Citizen also removes Comrade.
  const allRoles = await prisma.role.findMany({
    select: { id: true, name: true, requiresRoleId: true, isInternal: true },
  });
  const revokedIds = new Set<string>([role.id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const candidate of allRoles) {
      if (!candidate.isInternal && candidate.requiresRoleId && revokedIds.has(candidate.requiresRoleId) && !revokedIds.has(candidate.id)) {
        revokedIds.add(candidate.id);
        changed = true;
      }
    }
  }

  const held = await prisma.memberRole.findMany({
    where: { memberId, roleId: { in: [...revokedIds] } },
    include: { role: true },
  });
  if (held.length === 0) return [];

  await prisma.$transaction(async (tx) => {
    await tx.memberRole.deleteMany({
      where: { memberId, roleId: { in: held.map((entry) => entry.roleId) } },
    });
    await tx.roleHistory.createMany({
      data: held.map((entry) => ({
        memberId,
        roleId: entry.roleId,
        action: "REVOKE",
        actorId,
        reason: reason ?? (entry.role.name === roleName ? "Role removed" : "Prerequisite " + roleName + " removed"),
      })),
    });
  });

  return held.map((entry) => entry.role.name);
}

async function discordIdForMember(memberId: string): Promise<string | null> {
  const member = await prisma.discordMember.findUnique({ where: { id: memberId }, include: { user: true } });
  return member?.user.discordId ?? null;
}

async function syncDiscordRole(guild: Guild | undefined, memberId: string, roleName: string, add: boolean): Promise<void> {
  if (!guild) return;
  const role = await prisma.role.findUnique({ where: { name: roleName } });
  if (!role?.discordRoleId) return;
  const discordId = await discordIdForMember(memberId);
  if (!discordId) return;
  const guildMember = await guild.members.fetch(discordId).catch(() => null);
  if (!guildMember) return;
  if (add) await guildMember.roles.add(role.discordRoleId).catch(() => undefined);
  else await guildMember.roles.remove(role.discordRoleId).catch(() => undefined);
}

/**
 * Assign a community role: DB grant plus the matching Discord guild role
 * when a guild and a configured discordRoleId exist. Public roles never
 * grant admin permissions; that is enforced by keeping permissions in
 * InternalTeamMember/PermissionGroup only.
 */
export async function assignRole(memberId: string, roleName: string, actorId: string, reason?: string, guild?: Guild) {
  await grantRole(memberId, roleName, actorId, reason);
  await syncDiscordRole(guild, memberId, roleName, true);
}

/** Remove a community role from the DB and from Discord when possible. */
export async function removeRole(memberId: string, roleName: string, actorId: string, reason?: string, guild?: Guild) {
  const removedRoles = await revokeRole(memberId, roleName, actorId, reason);
  for (const removedRole of removedRoles) {
    await syncDiscordRole(guild, memberId, removedRole, false);
  }
  await audit(actorId, "roles.remove", "Role", roleName, { memberId, removedRoles });
}

export async function getMemberRoles(memberId: string) {
  return prisma.memberRole.findMany({
    where: { memberId },
    include: { role: true },
    orderBy: { grantedAt: "asc" },
  });
}

export async function getRoleHistory(memberId: string, take = 50) {
  return prisma.roleHistory.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    take,
    include: { role: true },
  });
}

/** Roles members can assign to themselves (interest roles). */
export async function listSelfAssignable() {
  return prisma.role.findMany({
    where: { isSelfAssignable: true, isInternal: false },
    orderBy: { sortOrder: "asc" },
  });
}

export interface ProgressionThresholds {
  socialiteMinCommunityPoints: number;
  creatorMinApprovedSubmissions: number;
  intellectMinContributionPoints: number;
}

async function progressionConfig(): Promise<ProgressionThresholds> {
  return getConfig<ProgressionThresholds>("roleProgression", {
    socialiteMinCommunityPoints: 100,
    creatorMinApprovedSubmissions: 3,
    intellectMinContributionPoints: 90,
  });
}

/**
 * Check earned progression roles from real activity and grant any newly
 * qualified ones. Socialite: community points threshold. Creator:
 * approved creative submissions threshold. Intellect: contribution
 * points threshold. Returns the roles newly granted.
 */
export async function checkProgression(memberId: string, actorId: string, guild?: Guild): Promise<string[]> {
  const thresholds = await progressionConfig();
  const balance = await prisma.pointBalance.findUnique({ where: { memberId } });
  const creativeSubmissions = await prisma.campaignSubmission.count({
    where: {
      memberId,
      status: "APPROVED",
      category: { in: ["creative", "graphic_design", "infographic", "video", "article", "social_post"] },
    },
  });
  const researchPoints = await prisma.campaignSubmission.aggregate({
    where: {
      memberId,
      status: "APPROVED",
      category: { in: ["research", "education", "industry_research", "educational_thread", "contribution_article"] },
    },
    _sum: { pointsAwarded: true },
  });
  const granted: string[] = [];

  const evaluate = async (roleName: string, qualifies: boolean) => {
    const role = await prisma.role.findUnique({ where: { name: roleName } });
    if (!role || role.isInternal) return;
    const held = await prisma.memberRole.findUnique({
      where: { memberId_roleId: { memberId, roleId: role.id } },
    });

    if (qualifies && !held) {
      try {
        await assignRole(memberId, roleName, actorId, "Progression threshold reached", guild);
        granted.push(roleName);
      } catch {
        // Missing prerequisite or deleted Discord role; staff can review history.
      }
      return;
    }

    if (!qualifies && held) {
      const latestGrant = await prisma.roleHistory.findFirst({
        where: { memberId, roleId: role.id, action: "GRANT" },
        orderBy: { createdAt: "desc" },
      });
      // Only automatically remove roles originally earned through progression.
      // Staff-awarded recognition and manually configured roles are preserved.
      if (latestGrant?.reason === "Progression threshold reached") {
        await removeRole(memberId, roleName, actorId, "Progression requirement no longer met", guild);
      }
    }
  };

  await evaluate("Socialite", (balance?.communityPoints ?? 0) >= thresholds.socialiteMinCommunityPoints);
  await evaluate("Creator", creativeSubmissions >= thresholds.creatorMinApprovedSubmissions);
  await evaluate("Intellect", (researchPoints._sum.pointsAwarded ?? 0) >= thresholds.intellectMinContributionPoints);
  return granted;
}

/** Grant Citizen after a successful verification. Idempotent. */
export async function grantCitizenAfterVerification(memberId: string, actorId: string, guild?: Guild) {
  const member = await prisma.discordMember.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");
  const updated = await prisma.discordMember.update({
    where: { id: memberId },
    data: { verifiedAt: new Date() },
  });
  await assignRole(memberId, "Citizen", actorId, "Verification completed", guild);

  // If X follow was verified before Discord verification, grant Comrade now
  // that the Citizen prerequisite is satisfied.
  if (updated.xFollowVerified) {
    await assignRole(memberId, "Comrade", actorId, "Citizen and X follow requirements satisfied", guild);
    const referral = await prisma.referral.findFirst({ where: { referredId: memberId, verified: true } });
    if (referral) {
      await checkComradeConversion(referral.id).catch((err) =>
        audit(actorId, "referrals.comrade_bonus_failed", "Referral", referral.id, {
          message: err instanceof Error ? err.message : String(err),
        }));
    }
  }
}

/**
 * Grant Comrade. Requires Citizen already held and a verified X follow
 * (DiscordMember.xFollowVerified, set by staff or a supported integration).
 */
export async function grantComrade(memberId: string, actorId: string, guild?: Guild) {
  if (!(await hasPermission(actorId, "roles.assign"))) {
    throw new Error("Only authorized staff can verify X follows and grant Comrade");
  }
  const member = await prisma.discordMember.findUnique({ where: { id: memberId } });
  if (!member) throw new Error("Member not found");
  if (!member.xFollowVerified) throw new Error("X follow has not been verified for this member");
  const citizen = await prisma.role.findUnique({ where: { name: "Citizen" } });
  if (!citizen) throw new Error("Citizen role is not configured");
  const hasCitizen = await prisma.memberRole.findUnique({
    where: { memberId_roleId: { memberId, roleId: citizen.id } },
  });
  if (!hasCitizen) throw new Error("Comrade requires the Citizen role first");
  await assignRole(memberId, "Comrade", actorId, "X follow verified", guild);
  const referral = await prisma.referral.findFirst({ where: { referredId: memberId, verified: true } });
  if (referral) {
    await checkComradeConversion(referral.id).catch((err) =>
      audit(actorId, "referrals.comrade_bonus_failed", "Referral", referral.id, { message: err instanceof Error ? err.message : String(err) }));
  }
}

/** Mark a member's X follow as verified (staff or supported integration). */
export async function setXFollowVerified(memberId: string, actorId: string, verified: boolean, guild?: Guild) {
  if (!(await hasPermission(actorId, "roles.assign"))) {
    throw new Error("You do not have permission to verify X follows");
  }
  const updated = await prisma.discordMember.update({
    where: { id: memberId },
    data: { xFollowVerified: verified, xFollowVerifiedAt: verified ? new Date() : null },
  });
  await audit(actorId, "roles.x_follow_verified", "DiscordMember", memberId, { verified });
  if (!verified) await removeRole(memberId, "Comrade", actorId, "X follow verification removed", guild);
  return updated;
}

/**
 * Staff-awarded recognition. Only Pioneer and Luminary may be awarded
 * this way, and only by staff holding roles.assign.
 */
export async function staffAward(memberId: string, roleName: string, staffDiscordId: string, reason?: string, guild?: Guild) {
  if (roleName !== "Pioneer" && roleName !== "Luminary") {
    throw new Error("Staff awards are only for Pioneer and Luminary");
  }
  if (!(await hasPermission(staffDiscordId, "roles.assign"))) {
    throw new Error("You do not have permission to award roles");
  }
  await assignRole(memberId, roleName, staffDiscordId, reason ?? "Staff recognition", guild);
}
