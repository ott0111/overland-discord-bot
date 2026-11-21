import { getGuild } from "../store.js";

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
