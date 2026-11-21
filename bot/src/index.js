import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Events,
  REST,
  Routes,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  PermissionFlagsBits
} from "discord.js";

import { commands } from "./commands.js";
import {
  analyticsEmbed,
  configEmbed,
  errorEmbed,
  moderationEmbed,
  successEmbed,
  ticketPanelEmbed,
  ticketWelcomeEmbed,
  welcomeEmbed
} from "./embeds.js";
import { getGuild, loadStore, saveStore, updateGuild } from "./store.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID || null;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID. Check bot/.env.");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages
  ]
});

const commandData = new Map(commands.map((command) => [command.name, command]));

async function reply(interaction, embed, ephemeral = true) {
  const payload = { embeds: [embed] };
  if (ephemeral) payload.flags = MessageFlags.Ephemeral;

  if (interaction.deferred || interaction.replied) {
    return interaction.followUp(payload);
  }
  return interaction.reply(payload);
}

async function sendModLog(guild, embed) {
  const config = getGuild(guild.id);
  if (!config.modLogChannelId) return;

  try {
    const channel = await guild.channels.fetch(config.modLogChannelId);
    if (channel?.isTextBased()) await channel.send({ embeds: [embed] });
  } catch (error) {
    console.error("Could not send moderation log:", error.message);
  }
}

async function logAction(guild, action, target, moderator, reason, duration) {
  const embed = moderationEmbed(client, {
    action,
    target,
    moderator,
    reason,
    duration
  });
  await sendModLog(guild, embed);
}

async function syncCommands() {
  const rest = new REST({ version: "10" }).setToken(token);
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commands });
  console.log("Registered " + commands.length + " slash commands.");
  if (!guildId) console.log("Global slash commands may take time to appear.");
}

async function handleCommand(interaction) {
  const name = interaction.commandName;
  const config = getGuild(interaction.guildId);

  if (name === "setup") {
    return reply(interaction, configEmbed(client, config));
  }

  if (name === "autorole") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "set") {
      const role = interaction.options.getRole("role");
      await updateGuild(interaction.guildId, { autoRoleId: role.id });
      return reply(interaction, successEmbed(client, "Auto role updated", "New members will now receive " + role + "."));
    }
    await updateGuild(interaction.guildId, { autoRoleId: null });
    return reply(interaction, successEmbed(client, "Auto role disabled", "Automatic role assignment has been turned off."));
  }

  if (name === "welcome") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "set") {
      const channel = interaction.options.getChannel("channel");
      await updateGuild(interaction.guildId, { welcomeChannelId: channel.id });
      return reply(interaction, successEmbed(client, "Welcome messages enabled", "New member welcomes will be posted in " + channel + "."));
    }
    await updateGuild(interaction.guildId, { welcomeChannelId: null });
    return reply(interaction, successEmbed(client, "Welcome messages disabled", "New member welcome messages have been turned off."));
  }

  if (name === "modlog") {
    const subcommand = interaction.options.getSubcommand();
    if (subcommand === "set") {
      const channel = interaction.options.getChannel("channel");
      await updateGuild(interaction.guildId, { modLogChannelId: channel.id });
      return reply(interaction, successEmbed(client, "Moderation logs enabled", "Moderation events will be sent to " + channel + "."));
    }
    await updateGuild(interaction.guildId, { modLogChannelId: null });
    return reply(interaction, successEmbed(client, "Moderation logs disabled", "Moderation logging has been turned off."));
  }

  if (name === "ticket-setup") {
    const channel = interaction.options.getChannel("channel");
    const category = interaction.options.getChannel("category");
    const supportRole = interaction.options.getRole("support-role");

    await updateGuild(interaction.guildId, {
      ticketPanelChannelId: channel.id,
      ticketCategoryId: category?.id || null,
      ticketSupportRoleId: supportRole?.id || null
    });

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("overland:ticket:create")
        .setLabel("Open a ticket")
        .setStyle(ButtonStyle.Success)
    );

    await channel.send({ embeds: [ticketPanelEmbed(client)], components: [row] });
    return reply(interaction, successEmbed(client, "Ticket panel posted", "Your support panel is now live in " + channel + "."));
  }

  if (name === "analytics") {
    return reply(interaction, analyticsEmbed(client, interaction.guild, config.stats));
  }

  if (name === "warn") {
    const user = interaction.options.getUser("member");
    const reason = interaction.options.getString("reason");
    config.warnings.push({
      userId: user.id,
      moderatorId: interaction.user.id,
      reason,
      createdAt: new Date().toISOString()
    });
    await saveStore();
    await logAction(interaction.guild, "Warning", user.tag, interaction.user.tag, reason);
    return reply(interaction, successEmbed(client, "Warning recorded", user.tag + " has been warned.\n\n**Reason**\n" + reason));
  }

  if (name === "kick") {
    const user = interaction.options.getUser("member");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const member = await interaction.guild.members.fetch(user.id);
    if (!member.kickable) return reply(interaction, errorEmbed(client, "Action blocked", "I cannot kick this member. Check my role position and permissions."));

    await member.kick(reason);
    await logAction(interaction.guild, "Kick", user.tag, interaction.user.tag, reason);
    return reply(interaction, successEmbed(client, "Member kicked", user.tag + " has been removed from the server."));
  }

  if (name === "ban") {
    const user = interaction.options.getUser("member");
    const reason = interaction.options.getString("reason") || "No reason provided";
    await interaction.guild.members.ban(user.id, { reason });
    await logAction(interaction.guild, "Ban", user.tag, interaction.user.tag, reason);
    return reply(interaction, successEmbed(client, "Member banned", user.tag + " has been banned from the server."));
  }

  if (name === "timeout") {
    const user = interaction.options.getUser("member");
    const minutes = interaction.options.getInteger("minutes");
    const reason = interaction.options.getString("reason") || "No reason provided";
    const member = await interaction.guild.members.fetch(user.id);
    if (!member.moderatable) return reply(interaction, errorEmbed(client, "Action blocked", "I cannot timeout this member. Check my role position and permissions."));

    await member.timeout(minutes * 60 * 1000, reason);
    await logAction(interaction.guild, "Timeout", user.tag, interaction.user.tag, reason, minutes + " minutes");
    return reply(interaction, successEmbed(client, "Timeout applied", user.tag + " has been timed out for " + minutes + " minutes."));
  }

  if (name === "purge") {
    const amount = interaction.options.getInteger("amount");
    const deleted = await interaction.channel.bulkDelete(amount, true);
    return reply(interaction, successEmbed(client, "Messages cleared", "Deleted " + deleted.size + " recent messages."));
  }

  return reply(interaction, errorEmbed(client, "Command unavailable", "That command is not registered in this bot build."));
}

async function createTicket(interaction) {
  const guild = interaction.guild;
  const config = getGuild(guild.id);
  const existing = guild.channels.cache.find((channel) =>
    channel.type === ChannelType.GuildText &&
    channel.topic === "overland-ticket:" + interaction.user.id
  );

  if (existing) {
    return reply(interaction, successEmbed(client, "You already have a ticket", "Continue your conversation here: " + existing));
  }

  const overwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: interaction.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles
      ]
    },
    {
      id: guild.members.me.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels
      ]
    }
  ];

  if (config.ticketSupportRoleId) {
    overwrites.push({
      id: config.ticketSupportRoleId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    });
  }

  const safeName = interaction.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 18);
  const channel = await guild.channels.create({
    name: "ticket-" + safeName,
    type: ChannelType.GuildText,
    topic: "overland-ticket:" + interaction.user.id,
    parent: config.ticketCategoryId || undefined,
    permissionOverwrites: overwrites
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("overland:ticket:close")
      .setLabel("Close ticket")
      .setStyle(ButtonStyle.Secondary)
  );

  await channel.send({
    content: interaction.user.toString() + (config.ticketSupportRoleId ? " <@&" + config.ticketSupportRoleId + ">" : ""),
    embeds: [ticketWelcomeEmbed(client, interaction.user)],
    components: [row],
    allowedMentions: { users: [interaction.user.id], roles: config.ticketSupportRoleId ? [config.ticketSupportRoleId] : [] }
  });

  return reply(interaction, successEmbed(client, "Ticket created", "Your private support channel is ready: " + channel));
}

async function closeTicket(interaction) {
  const channel = interaction.channel;
  const ownerId = channel.topic?.startsWith("overland-ticket:")
    ? channel.topic.slice("overland-ticket:".length)
    : null;

  if (!ownerId) {
    return reply(interaction, errorEmbed(client, "Not a ticket", "This channel is not an Overland support ticket."));
  }

  const isOwner = interaction.user.id === ownerId;
  const isStaff = interaction.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  if (!isOwner && !isStaff) {
    return reply(interaction, errorEmbed(client, "Access denied", "Only the ticket creator or a moderator can close this ticket."));
  }

  await reply(interaction, successEmbed(client, "Ticket closed", "This channel will be removed in a few seconds."));
  await logAction(interaction.guild, "Ticket closed", channel.name, interaction.user.tag, "Closed by ticket owner or staff");
  setTimeout(() => channel.delete("Overland ticket closed").catch(() => {}), 4000);
}

client.once(Events.ClientReady, async (readyClient) => {
  console.log("Overland Finance bot online as " + readyClient.user.tag);
  try {
    await syncCommands();
  } catch (error) {
    console.error("Slash command sync failed:", error.message);
    console.error("Check the bot token, client ID, and applications.commands invite scope.");
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (interaction.isChatInputCommand()) {
      await handleCommand(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === "overland:ticket:create") {
      await createTicket(interaction);
      return;
    }

    if (interaction.isButton() && interaction.customId === "overland:ticket:close") {
      await closeTicket(interaction);
    }
  } catch (error) {
    console.error("Interaction failed:", error);
    const embed = errorEmbed(client, "Something went wrong", "The request could not be completed. Check the bot logs for details.");
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ embeds: [embed], flags: MessageFlags.Ephemeral });
      } else {
        await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }
    } catch {}
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const config = getGuild(member.guild.id);
  config.stats.joins += 1;
  await saveStore();

  if (config.autoRoleId) {
    const role = await member.guild.roles.fetch(config.autoRoleId).catch(() => null);
    if (role) await member.roles.add(role).catch((error) => console.error("Auto role failed:", error.message));
  }

  if (config.welcomeChannelId) {
    const channel = await member.guild.channels.fetch(config.welcomeChannelId).catch(() => null);
    if (channel?.isTextBased()) {
      await channel.send({ embeds: [welcomeEmbed(client, member)] }).catch((error) => console.error("Welcome message failed:", error.message));
    }
  }
});

client.on(Events.GuildMemberRemove, async (member) => {
  const config = getGuild(member.guild.id);
  config.stats.leaves += 1;
  await saveStore();
});

client.on(Events.MessageCreate, (message) => {
  if (!message.guild || message.author.bot) return;
  const config = getGuild(message.guild.id);
  config.stats.messages += 1;
});


const saveInterval = setInterval(() => {
  saveStore();
}, 15000);

async function shutdown(signal) {
  console.log("Received " + signal + ", saving data and shutting down.");
  clearInterval(saveInterval);
  await saveStore();
  client.destroy();
  process.exit(0);
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

await loadStore();
await client.login(token);
