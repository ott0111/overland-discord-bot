import { EmbedBuilder } from "discord.js";

export const BRAND = {
  emerald: 0x0D8F72,
  lime: 0xA8DCCB,
  ink: 0x101916,
  muted: 0x9BAFA8,
  danger: 0xD94F61,
  warning: 0xD9A441
};

const FOOTER = "OVERLAND FINANCE  •  COMMUNITY";

export function baseEmbed(client, title, description, color = BRAND.emerald) {
  const e = new EmbedBuilder().setColor(color).setTitle(title).setDescription(description).setTimestamp().setFooter({ text: FOOTER });
  const icon = process.env.OVERLAND_ICON_URL || client?.user?.displayAvatarURL();
  e.setAuthor({ name: "OVERLAND FINANCE", ...(icon ? { iconURL: icon } : {}) });
  return e;
}
export function successEmbed(client, title, description) { return baseEmbed(client, title, description, BRAND.emerald); }
export function infoEmbed(client, title, description) { return baseEmbed(client, title, description, BRAND.lime); }
export function errorEmbed(client, title, description) { return baseEmbed(client, title, description, BRAND.danger); }
export function welcomeEmbed(client, member) {
  return baseEmbed(client, "WELCOME TO OVERLAND", "Welcome " + member + ". You're now part of the community. Take a moment to review the server and get settled in.")
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields({ name: "MEMBER", value: member.user.username, inline: true }, { name: "COMMUNITY SIZE", value: String(member.guild.memberCount), inline: true });
}
export function ticketPanelEmbed(client) {
  return baseEmbed(client, "OVERLAND SUPPORT", "A dedicated support desk for the Overland community. Open a private ticket and our team will get back to you.")
    .addFields(
      { name: "SUPPORT", value: "Questions and community assistance.", inline: true },
      { name: "REPORTS", value: "Bring an issue to the team's attention.", inline: true },
      { name: "PARTNERSHIPS", value: "Business and collaboration requests.", inline: true },
      { name: "APPLICATIONS", value: "Applications and opportunities.", inline: true },
      { name: "SECURITY", value: "Never share passwords, seed phrases, or private keys.", inline: false }
    );
}
export function ticketWelcomeEmbed(client, member) {
  return baseEmbed(client, "SUPPORT REQUEST OPENED", "Welcome " + member + ". Please explain what you need help with and include relevant context.")
    .addFields({ name: "NEXT STEP", value: "A team member will review your request as soon as possible.", inline: false });
}
export function moderationEmbed(client, { action, target, moderator, reason, duration }) {
  const e = baseEmbed(client, "MODERATION  /  " + action, "A moderation action was recorded.", BRAND.warning)
    .addFields({ name: "MEMBER", value: String(target), inline: true }, { name: "MODERATOR", value: String(moderator), inline: true }, { name: "REASON", value: reason || "No reason provided", inline: false });
  if (duration) e.addFields({ name: "DURATION", value: duration, inline: true });
  return e;
}
export function analyticsEmbed(client, guild, stats) {
  return baseEmbed(client, "COMMUNITY ANALYTICS", "A quick overview of your Overland server.")
    .addFields(
      { name: "MEMBERS", value: guild.memberCount.toLocaleString(), inline: true },
      { name: "MESSAGES TRACKED", value: Number(stats.messages || 0).toLocaleString(), inline: true },
      { name: "JOINS TRACKED", value: Number(stats.joins || 0).toLocaleString(), inline: true },
      { name: "LEAVES TRACKED", value: Number(stats.leaves || 0).toLocaleString(), inline: true }
    );
}
export function configEmbed(client, config) {
  const channel = id => id ? "<#" + id + ">" : "Not configured";
  const role = id => id ? "<@&" + id + ">" : "Not configured";
  return baseEmbed(client, "SERVER CONFIGURATION", "Your current Overland bot settings.")
    .addFields(
      { name: "AUTO ROLE", value: role(config.autoRoleId), inline: true },
      { name: "WELCOME CHANNEL", value: channel(config.welcomeChannelId), inline: true },
      { name: "MOD LOG CHANNEL", value: channel(config.modLogChannelId), inline: true },
      { name: "TICKET CATEGORY", value: channel(config.ticketCategoryId), inline: true },
      { name: "ARCHIVE CATEGORY", value: channel(config.ticketArchiveCategoryId), inline: true },
      { name: "SUPPORT ROLE", value: role(config.ticketSupportRoleId), inline: true }
    );
}
