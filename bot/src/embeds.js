import { EmbedBuilder } from "discord.js";

export const BRAND = {
  emerald: 0x00C982,
  lime: 0xC5E86C,
  ink: 0x101916,
  muted: 0x9AA7A1,
  danger: 0xE35D6A,
  warning: 0xE7B95B
};

const FOOTER = "OVERLAND FINANCE  •  COMMUNITY";

export function baseEmbed(client, title, description, color = BRAND.emerald) {
  const embed = new EmbedBuilder()
    .setColor(color)
    .setTitle(title)
    .setDescription(description)
    .setTimestamp()
    .setFooter({ text: FOOTER });

  const brandIcon = process.env.OVERLAND_ICON_URL || client?.user?.displayAvatarURL();
  embed.setAuthor({
    name: "Overland Finance",
    ...(brandIcon ? { iconURL: brandIcon } : {})
  });

  return embed;
}

export function successEmbed(client, title, description) {
  return baseEmbed(client, title, description, BRAND.emerald);
}

export function infoEmbed(client, title, description) {
  return baseEmbed(client, title, description, BRAND.lime);
}

export function errorEmbed(client, title, description) {
  return baseEmbed(client, title, description, BRAND.danger);
}

export function welcomeEmbed(client, member) {
  return baseEmbed(
    client,
    "Welcome to Overland Finance",
    "Welcome " + member + ".\n\nYou're now part of the community. Take a moment to review the server and get settled in."
  )
    .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
    .addFields(
      { name: "Member", value: member.user.username, inline: true },
      { name: "Member count", value: String(member.guild.memberCount), inline: true }
    );
}

export function ticketPanelEmbed(client) {
  return baseEmbed(
    client,
    "Overland Support",
    "Need a hand? Open a private ticket and our team will get back to you.\n\n**Before opening a ticket**\n• Choose the right channel for your request.\n• Include the details our team needs.\n• Please avoid opening duplicate tickets."
  )
    .addFields({
      name: "Support hours",
      value: "Our team will respond as soon as a member is available.",
      inline: false
    });
}

export function ticketWelcomeEmbed(client, member) {
  return baseEmbed(
    client,
    "Ticket opened",
    "Welcome " + member + ".\n\nPlease explain what you need help with. A team member will be with you shortly."
  );
}

export function moderationEmbed(client, { action, target, moderator, reason, duration }) {
  const embed = baseEmbed(
    client,
    "Moderation • " + action,
    "**Member**\n" + target + "\n\n**Moderator**\n" + moderator + "\n\n**Reason**\n" + (reason || "No reason provided"),
    BRAND.warning
  );

  if (duration) embed.addFields({ name: "Duration", value: duration, inline: true });
  return embed;
}

export function analyticsEmbed(client, guild, stats) {
  return baseEmbed(
    client,
    "Community analytics",
    "A quick overview of your Overland server."
  )
    .addFields(
      { name: "Members", value: guild.memberCount.toLocaleString(), inline: true },
      { name: "Messages tracked", value: Number(stats.messages || 0).toLocaleString(), inline: true },
      { name: "Joins tracked", value: Number(stats.joins || 0).toLocaleString(), inline: true },
      { name: "Leaves tracked", value: Number(stats.leaves || 0).toLocaleString(), inline: true }
    );
}

export function configEmbed(client, guildConfig) {
  const channel = (id) => id ? "<#" + id + ">" : "Not configured";
  const role = (id) => id ? "<@&" + id + ">" : "Not configured";

  return baseEmbed(client, "Server configuration", "Your current Overland bot settings.")
    .addFields(
      { name: "Auto role", value: role(guildConfig.autoRoleId), inline: true },
      { name: "Welcome channel", value: channel(guildConfig.welcomeChannelId), inline: true },
      { name: "Mod log channel", value: channel(guildConfig.modLogChannelId), inline: true },
      { name: "Ticket category", value: channel(guildConfig.ticketCategoryId), inline: true },
      { name: "Ticket support role", value: role(guildConfig.ticketSupportRoleId), inline: true },
      { name: "Ticket panel", value: channel(guildConfig.ticketPanelChannelId), inline: true }
    );
}
