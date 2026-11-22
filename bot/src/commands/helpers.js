import { EmbedBuilder, MessageFlags } from "discord.js";
import { hasPermission } from "../services/permissions.js";
import { getGuild, saveStore } from "../store.js";
import { findStaffMember } from "../db/repositories/staff.js";
import { checkProgression, syncDiscordRole } from "../services/roles.js";
import { checkAchievements } from "../services/achievements.js";

export const BRAND = { primary: 0x0D8F72, dark: 0x10231F, muted: 0x9BAFA8, danger: 0xD94F61, warning: 0xD9A441, success: 0x168A68 };

export function embed(title, description, color = BRAND.primary) {
  const e = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp()
    .setFooter({ text: "OVERLAND FINANCE  •  COMMUNITY" });
  const icon = process.env.OVERLAND_ICON_URL;
  e.setAuthor({ name: "OVERLAND FINANCE", ...(icon ? { iconURL: icon } : {}) });
  return e;
}
export function successEmbed(title, description) { return embed(title, description, BRAND.success); }
export function errorEmbed(title, description) { return embed(title, description, BRAND.danger); }
export function warningEmbed(title, description) { return embed(title, description, BRAND.warning); }

export async function reply(i, title, description, ephemeral = true) {
  const payload = { embeds: [embed(title, description)], ...(ephemeral ? { flags: MessageFlags.Ephemeral } : {}) };
  return i.deferred || i.replied ? i.editReply(payload) : i.reply(payload);
}
export function requirePerm(i, key) {
  if (hasPermission(i.guildId, i.user.id, key)) return;
  throw new Error("Missing internal permission: " + key);
}

export async function requirePermAsync(i, key) {
  if (process.env.OVERLAND_STORAGE === "mysql") {
    const staff = await findStaffMember(i.guildId, i.user.id);
    if (staff?.group === "Owner" || staff?.permissions?.includes(key)) return staff;
    throw new Error("Missing internal permission: " + key);
  }
  return requirePerm(i, key);
}
export async function syncMemberProgression(i, user) {
  await checkAchievements(i.guildId, user);
  const earned = await checkProgression(i.guildId, user);
  if (earned.length) {
    const member = await i.guild.members.fetch(user.id).catch(() => null);
    if (member) {
      for (const role of earned) await syncDiscordRole(getGuild(i.guildId), member, role, true).catch(() => {});
    }
  }
  return earned;
}

export function requireDiscordPerm(i, permission) {
  if (!i.memberPermissions?.has(permission)) throw new Error("You do not have the required Discord permission.");
}
export function command(data, execute) { return { data, execute }; }

export async function logModeration(i, action, target, reason, extra = {}) {
  const g = getGuild(i.guildId);
  const caseId = g.moderation.reduce((max, item) => Math.max(max, Number(item.caseId) || 0), 0) + 1;
  const entry = {
    id: crypto.randomUUID(), caseId, action, targetId: target.id,
    target: target.tag || target.username || target.id, moderatorId: i.user.id,
    moderator: i.user.tag, reason: reason || "No reason provided", at: new Date().toISOString(), ...extra
  };
  g.moderation.unshift(entry);
  await saveStore();
  if (g.settings.modLogChannelId) {
    const channel = await i.guild.channels.fetch(g.settings.modLogChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      const log = embed("MODERATION  /  " + action, "A moderation action was recorded.",
        ["BAN", "KICK", "TIMEOUT", "UNTIMEOUT"].includes(action) ? BRAND.warning : BRAND.primary)
        .addFields(
          { name: "Case", value: "#" + caseId, inline: true },
          { name: "Member", value: entry.target + " (" + target.id + ")", inline: false },
          { name: "Moderator", value: i.user.tag, inline: true },
          { name: "Reason", value: entry.reason.slice(0, 1024), inline: false }
        );
      if (extra.duration) log.addFields({ name: "Duration", value: extra.duration, inline: true });
      await channel.send({ embeds: [log] }).catch(() => {});
    }
  }
  return entry;
}
