import {
  SlashCommandBuilder,
  PermissionFlagsBits,
  ChannelType
} from "discord.js";

const admin = PermissionFlagsBits.ManageGuild;

export const commands = [
  new SlashCommandBuilder()
    .setName("setup")
    .setDescription("View the current Overland bot configuration")
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("autorole")
    .setDescription("Configure the role given to new members")
    .setDefaultMemberPermissions(admin)
    .addSubcommand((sub) => sub
      .setName("set")
      .setDescription("Set the automatic member role")
      .addRoleOption((option) => option.setName("role").setDescription("Role to assign").setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("clear")
      .setDescription("Disable automatic roles")),

  new SlashCommandBuilder()
    .setName("welcome")
    .setDescription("Configure member welcome messages")
    .setDefaultMemberPermissions(admin)
    .addSubcommand((sub) => sub
      .setName("set")
      .setDescription("Set the welcome channel")
      .addChannelOption((option) => option.setName("channel").setDescription("Welcome channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("disable")
      .setDescription("Disable welcome messages")),

  new SlashCommandBuilder()
    .setName("modlog")
    .setDescription("Configure moderation logs")
    .setDefaultMemberPermissions(admin)
    .addSubcommand((sub) => sub
      .setName("set")
      .setDescription("Set the moderation log channel")
      .addChannelOption((option) => option.setName("channel").setDescription("Log channel").addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((sub) => sub
      .setName("disable")
      .setDescription("Disable moderation logs")),

  new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Post the Overland support ticket panel")
    .setDefaultMemberPermissions(admin)
    .addChannelOption((option) => option.setName("channel").setDescription("Where the ticket panel should be posted").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption((option) => option.setName("category").setDescription("Category for new tickets").addChannelTypes(ChannelType.GuildCategory).setRequired(false))
    .addRoleOption((option) => option.setName("support-role").setDescription("Role that can view tickets").setRequired(false)),

  new SlashCommandBuilder()
    .setName("analytics")
    .setDescription("View basic community analytics")
    .setDefaultMemberPermissions(admin),

  new SlashCommandBuilder()
    .setName("warn")
    .setDescription("Warn a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName("member").setDescription("Member to warn").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason for the warning").setMaxLength(500).setRequired(true)),

  new SlashCommandBuilder()
    .setName("kick")
    .setDescription("Kick a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.KickMembers)
    .addUserOption((option) => option.setName("member").setDescription("Member to kick").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason for the kick").setMaxLength(500).setRequired(false)),

  new SlashCommandBuilder()
    .setName("ban")
    .setDescription("Ban a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.BanMembers)
    .addUserOption((option) => option.setName("member").setDescription("Member to ban").setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason for the ban").setMaxLength(500).setRequired(false)),

  new SlashCommandBuilder()
    .setName("timeout")
    .setDescription("Timeout a member")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .addUserOption((option) => option.setName("member").setDescription("Member to timeout").setRequired(true))
    .addIntegerOption((option) => option.setName("minutes").setDescription("Timeout length in minutes").setMinValue(1).setMaxValue(40320).setRequired(true))
    .addStringOption((option) => option.setName("reason").setDescription("Reason for the timeout").setMaxLength(500).setRequired(false)),

  new SlashCommandBuilder()
    .setName("purge")
    .setDescription("Delete recent messages")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .addIntegerOption((option) => option.setName("amount").setDescription("Number of messages, from 1 to 100").setMinValue(1).setMaxValue(100).setRequired(true))
].map((command) => command.toJSON());
