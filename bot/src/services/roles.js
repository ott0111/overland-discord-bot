import { getGuild, getMember, saveStore } from "../store.js";

export const ROLE_NAMES = ["Founder","Admin","Warden","Pioneer","Luminary","Creator","Intellect","Socialite","Comrade","Citizen"];
const INTERNAL = new Set(["Founder","Admin","Warden"]);
export function roleByName(name) { return ROLE_NAMES.find(x => x.toLowerCase() === String(name).toLowerCase()) || null; }

export async function grantRole(guildId, user, roleName, actorId, reason = "Role awarded") {
  const role = roleByName(roleName);
  if (!role) throw new Error("Unknown Overland role.");
  if (INTERNAL.has(role)) throw new Error("Internal roles are managed through the private team system, not public role commands.");
  const guild = getGuild(guildId), member = getMember(guildId, user);
  if (member.roles.includes(role)) return false;
  if (role === "Comrade" && !member.xFollowVerified) throw new Error("Comrade requires verified X follow status.");
  if (role === "Citizen" && !member.verifiedAt) throw new Error("Citizen is granted by completing verification.");
  member.roles.push(role);
  guild.roleHistory.unshift({ id: crypto.randomUUID(), memberId: member.id, role, action: "GRANTED", actorId, reason, at: new Date().toISOString() });
  if (role === "Socialite") member.socialiteAt = new Date().toISOString();
  await saveStore();
  return true;
}
export async function revokeRole(guildId, userId, roleName, actorId, reason = "Role removed") {
  const guild = getGuild(guildId), member = getMember(guildId, userId);
  const role = roleByName(roleName);
  if (!role || INTERNAL.has(role)) throw new Error("That role cannot be removed here.");
  const dependents = role === "Citizen" ? ["Comrade"] : [];
  const removed = [role, ...dependents].filter(x => member.roles.includes(x));
  member.roles = member.roles.filter(x => !removed.includes(x));
  for (const name of removed) guild.roleHistory.unshift({ id: crypto.randomUUID(), memberId: member.id, role: name, action: "REVOKED", actorId, reason, at: new Date().toISOString() });
  await saveStore();
  return removed;
}
export async function checkProgression(guildId, user) {
  const member = getMember(guildId, user);
  const guild = getGuild(guildId);
  const earned = [];
  if (member.verifiedAt && !member.roles.includes("Citizen")) { member.roles.push("Citizen"); earned.push("Citizen"); }
  if (member.verifiedAt && member.xFollowVerified && !member.roles.includes("Comrade")) { member.roles.push("Comrade"); earned.push("Comrade"); }
  if (member.overpoints >= 500 && !member.roles.includes("Socialite")) { member.roles.push("Socialite"); earned.push("Socialite"); }
  const creative = guild.submissions.filter(s => s.memberId === member.id && s.status === "APPROVED" && ["social_post","infographic","video","graphic_design","community_initiative"].includes(s.category)).length;
  const research = guild.submissions.filter(s => s.memberId === member.id && s.status === "APPROVED" && ["educational_thread","article","industry_research","contribution_article"].includes(s.category)).length;
  if (creative >= 3 && !member.roles.includes("Creator")) { member.roles.push("Creator"); earned.push("Creator"); }
  if (research >= 3 && !member.roles.includes("Intellect")) { member.roles.push("Intellect"); earned.push("Intellect"); }
  for (const role of earned) guild.roleHistory.unshift({ id: crypto.randomUUID(), memberId: member.id, role, action: "GRANTED", actorId: "SYSTEM", reason: "Automatic progression", at: new Date().toISOString() });
  if (earned.length) await saveStore();
  return earned;
}
export async function syncDiscordRole(guild, discordMember, roleName, add = true) {
  const id = guild.settings.roleIds[roleName];
  if (!id) return;
  const role = await discordMember.guild.roles.fetch(id).catch(() => null);
  if (!role) throw new Error("Discord role ID for " + roleName + " is not configured or the role no longer exists.");
  if (add) await discordMember.roles.add(role);
  else await discordMember.roles.remove(role);
}
