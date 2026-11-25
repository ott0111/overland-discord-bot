import { getGuild, saveStore } from "../store.js";
import { listTeam } from "../db/repositories/team.js";

export function getTeamMember(guildId, discordId) {
  return getGuild(guildId).team.find(x => x.discordId === discordId && x.status === "ACTIVE") || null;
}
export function hasPermission(guildId, discordId, key) {
  const member = getTeamMember(guildId, discordId);
  if (!member) return false;
  if (member.group === "Owner") return true;
  return (member.permissions || []).includes(key);
}
export function requirePermission(interaction, key) {
  if (hasPermission(interaction.guildId, interaction.user.id, key)) return true;
  throw new Error("You do not have the internal team permission: " + key);
}
export function isInternalStaff(guildId, discordId) {
  return Boolean(getTeamMember(guildId, discordId));
}

export async function syncTeamCacheFromMySQL(guildId) {
  if (process.env.OVERLAND_STORAGE !== "mysql") return;
  const rows = await listTeam(guildId);
  const guild = getGuild(guildId);
  guild.team = rows.map((row) => ({
    id: row.id,
    discordId: row.discordId,
    username: row.username,
    publicRole: row.publicRole,
    jobTitle: row.jobTitle,
    department: row.department,
    responsibilities: row.responsibilities,
    group: row.group?.name || null,
    permissions: Array.isArray(row.group?.permissions) ? row.group.permissions : [],
    status: row.status,
    addedAt: row.addedAt,
  }));
  await saveStore();
  return guild.team;
}
