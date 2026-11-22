import { SlashCommandBuilder, ChannelType, PermissionFlagsBits, AttachmentBuilder, MessageFlags, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { command, reply, requireDiscordPerm, embed, successEmbed } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
import { createTicketRecord, getTicketByChannel, updateTicket } from "../../db/repositories/tickets-rewards.js";

const categories = [
  { name: "Support", value: "support" },
  { name: "Reports", value: "reports" },
  { name: "Partnerships", value: "partnerships" },
  { name: "Applications", value: "applications" }
];
const isTicket = channel => Boolean(channel?.topic?.startsWith("overland-ticket:") || channel?.topic?.startsWith("overland-ticket-closed:"));
const ticketRecord = (guild, channelId) => guild.tickets.find(t => t.channelId === channelId) || null;
const safe = value => String(value || "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function openTicket(i) {
  const g = getGuild(i.guildId), category = i.options.getString("category", true);
  const existing = i.guild.channels.cache.find(c => c.type === ChannelType.GuildText && c.topic === "overland-ticket:" + i.user.id);
  if (existing) return reply(i, "You already have an open ticket", "Continue your request in " + existing + ".");
  const supportRoleId = g.settings.ticketSupportRoleId;
  const overwrites = [
    { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] },
    { id: i.client.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.ManageChannels, PermissionFlagsBits.ManageMessages] }
  ];
  if (supportRoleId) overwrites.push({ id: supportRoleId, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles] });
  const username = i.user.username.toLowerCase().replace(/[^a-z0-9-]/g, "-").slice(0, 18) || "member";
  const channel = await i.guild.channels.create({
    name: "ticket-" + category + "-" + username, type: ChannelType.GuildText,
    parent: g.settings.ticketCategoryId || undefined, topic: "overland-ticket:" + i.user.id,
    permissionOverwrites: overwrites, reason: "Support ticket opened by " + i.user.tag
  });
  const record = {
    id: "OV-" + Date.now().toString(36).toUpperCase(), channelId: channel.id, ownerId: i.user.id,
    ownerTag: i.user.tag, category, status: "OPEN", claimedBy: null, createdAt: new Date().toISOString(),
    closedAt: null, lastActivityAt: new Date().toISOString(), feedback: null
  };
  g.tickets.unshift(record);
  await saveStore();
  const panel = embed("OVERLAND SUPPORT  /  " + category.toUpperCase(),
    "Your private support room is ready. Please provide the context our team needs to help you.\n\n" +
    "**Ticket reference:** " + record.id + "\n**Opened by:** " + i.user + "\n**Category:** " +
    category.charAt(0).toUpperCase() + category.slice(1))
    .addFields(
      { name: "Helpful details", value: "Include relevant links, transaction references, screenshots, and the steps you have already taken.", inline: false },
      { name: "Keep it secure", value: "Never share passwords, seed phrases, private keys, or authentication codes with anyone.", inline: false }
    );
  await channel.send({ content: i.user.toString() + (supportRoleId ? " <@&" + supportRoleId + ">" : ""),
    embeds: [panel], allowedMentions: { users: [i.user.id], roles: supportRoleId ? [supportRoleId] : [] } });
  return reply(i, "Ticket created", "Your private support channel is ready: " + channel + "\nReference: **" + record.id + "**");
}

async function closeTicket(i) {
  const channel = i.channel;
  if (!isTicket(channel)) throw new Error("Use this command inside an Overland ticket.");
  const g = getGuild(i.guildId);
  const ownerId = channel.topic.startsWith("overland-ticket:") ? channel.topic.slice(16) : channel.topic.slice(23);
  const staff = i.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
  if (ownerId !== i.user.id && !staff) throw new Error("Only the ticket creator or authorized staff can close this ticket.");
  if (channel.topic.startsWith("overland-ticket-closed:")) return reply(i, "Ticket already closed", "This ticket has already been archived.");
  const record = ticketRecord(g, channel.id);
  if (record) { record.status = "CLOSED"; record.closedAt = new Date().toISOString(); record.closedBy = i.user.id; }
  await channel.permissionOverwrites.edit(ownerId, { ViewChannel: true, SendMessages: false, ReadMessageHistory: true }).catch(() => {});
  await channel.setTopic("overland-ticket-closed:" + ownerId).catch(() => {});
  await channel.setName(("closed-" + channel.name).slice(0, 95)).catch(() => {});
  if (g.settings.ticketArchiveCategoryId) await channel.setParent(g.settings.ticketArchiveCategoryId).catch(() => {});
  await saveStore();
  const feedbackRow = new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n => new ButtonBuilder().setCustomId("overland:ticket:feedback:" + n).setLabel(n + " / 5").setStyle(n >= 4 ? ButtonStyle.Success : ButtonStyle.Secondary)));
  await channel.send({ embeds: [successEmbed("TICKET ARCHIVED", "This ticket has been closed by " + i.user + ". Staff can still review its history.")] }).catch(() => {});
  await channel.send({ embeds: [embed("HOW DID WE DO?", "If you opened this ticket, rate your support experience below. Your feedback helps improve Overland support.")], components: [feedbackRow] }).catch(() => {});
  return reply(i, "Ticket archived", "The ticket is now closed and retained for staff review.");
}

async function claimTicket(i) {
  requireDiscordPerm(i, PermissionFlagsBits.ManageChannels);
  if (!isTicket(i.channel) || i.channel.topic.startsWith("overland-ticket-closed:")) throw new Error("This is not an open ticket.");
  const g = getGuild(i.guildId), record = process.env.OVERLAND_STORAGE === "mysql" ? await getTicketByChannel(i.guildId, i.channelId) : ticketRecord(g, i.channelId);
  if (!record) throw new Error("Ticket record not found. Ask an administrator to review the ticket setup.");
  if (record.claimedBy && record.claimedBy !== i.user.id) throw new Error("This ticket is already claimed by <@" + record.claimedBy + ">.");
  record.claimedBy = i.user.id; record.claimedAt = new Date().toISOString();
  await saveStore();
  await i.channel.send({ embeds: [successEmbed("TICKET CLAIMED", "This request is now being handled by " + i.user + ".")] });
  return reply(i, "Ticket claimed", "You are now assigned to this ticket.");
}

async function memberAccess(i, add) {
  requireDiscordPerm(i, PermissionFlagsBits.ManageChannels);
  if (!isTicket(i.channel)) throw new Error("Use this command inside an Overland ticket.");
  const user = i.options.getUser("member", true);
  if (add) await i.channel.permissionOverwrites.edit(user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true, AttachFiles: true });
  else await i.channel.permissionOverwrites.delete(user.id).catch(() => {});
  return reply(i, add ? "Member added" : "Member removed", user.tag + (add ? " can now access this ticket." : " no longer has ticket access."));
}

async function renameTicket(i) {
  requireDiscordPerm(i, PermissionFlagsBits.ManageChannels);
  if (!isTicket(i.channel)) throw new Error("Use this command inside an Overland ticket.");
  const name = i.options.getString("name", true).toLowerCase().replace(/[^a-z0-9-]/g, "-").replace(/-+/g, "-").slice(0, 90);
  await i.channel.setName(name);
  return reply(i, "Ticket renamed", "Channel name updated to **" + name + "**.");
}

async function transcript(i) {
  requireDiscordPerm(i, PermissionFlagsBits.ManageMessages);
  if (!isTicket(i.channel)) throw new Error("Use this command inside an Overland ticket.");
  await i.deferReply({ flags: MessageFlags.Ephemeral });
  const messages = await i.channel.messages.fetch({ limit: 100 });
  const ordered = [...messages.values()].sort((a, b) => a.createdTimestamp - b.createdTimestamp);
  const rows = ordered.map(m => {
    const attachments = [...m.attachments.values()].map(a => '<a href="' + safe(a.url) + '">' + safe(a.name || "attachment") + "</a>").join(" · ");
    return "<article><header><strong>" + safe(m.author.tag) + "</strong><time>" + new Date(m.createdTimestamp).toISOString() +
      "</time></header><p>" + safe(m.cleanContent).replace(/\n/g, "<br>") + (attachments ? "<br>" + attachments : "") + "</p></article>";
  }).join("\n");
  const html = "<!doctype html><html><head><meta charset=\"utf-8\"><title>Overland Ticket Transcript</title><style>" +
    "body{font:14px system-ui;background:#101916;color:#e7f0ec;margin:32px}h1{color:#7ee0bd}article{padding:14px 0;border-bottom:1px solid #294139}" +
    "header{display:flex;gap:14px;align-items:center}time{color:#91a79e;font-size:12px}p{line-height:1.6}a{color:#7ee0bd}</style></head><body>" +
    "<h1>OVERLAND FINANCE · TICKET TRANSCRIPT</h1><p>Channel: #" + safe(i.channel.name) + " · Generated: " + new Date().toISOString() + "</p>" +
    rows + "</body></html>";
  const file = new AttachmentBuilder(Buffer.from(html, "utf8"), { name: "overland-" + i.channel.id + "-transcript.html" });
  return i.editReply({ content: "Transcript generated. This export includes the latest 100 messages.", files: [file] });
}

export default command(
  new SlashCommandBuilder().setName("ticket").setDescription("Open and manage private Overland support tickets")
    .addSubcommand(s => s.setName("open").setDescription("Open a new support ticket")
      .addStringOption(o => o.setName("category").setDescription("What do you need help with?").setRequired(true).addChoices(...categories)))
    .addSubcommand(s => s.setName("close").setDescription("Close and archive this ticket"))
    .addSubcommand(s => s.setName("claim").setDescription("Assign this ticket to yourself"))
    .addSubcommand(s => s.setName("add").setDescription("Give a member access to this ticket").addUserOption(o => o.setName("member").setDescription("Member").setRequired(true)))
    .addSubcommand(s => s.setName("remove").setDescription("Remove a member from this ticket").addUserOption(o => o.setName("member").setDescription("Member").setRequired(true)))
    .addSubcommand(s => s.setName("rename").setDescription("Rename this ticket").addStringOption(o => o.setName("name").setDescription("New channel name").setRequired(true)))
    .addSubcommand(s => s.setName("transcript").setDescription("Export the ticket transcript as HTML"))
    .addSubcommand(s => s.setName("status").setDescription("View this ticket's status")),
  async i => {
    const sub = i.options.getSubcommand();
    if (sub === "open") return openTicket(i);
    if (sub === "close") return closeTicket(i);
    if (sub === "claim") return claimTicket(i);
    if (sub === "add") return memberAccess(i, true);
    if (sub === "remove") return memberAccess(i, false);
    if (sub === "rename") return renameTicket(i);
    if (sub === "transcript") return transcript(i);
    if (sub === "status") {
      if (!isTicket(i.channel)) throw new Error("Use this command inside an Overland ticket.");
      const record = process.env.OVERLAND_STORAGE === "mysql" ? await getTicketByChannel(i.guildId, i.channelId) : ticketRecord(getGuild(i.guildId), i.channelId);
      if (!record) throw new Error("Ticket record not found.");
      return reply(i, "Ticket status  /  " + record.id,
        "**Status:** " + record.status + "\n**Category:** " + record.category + "\n**Opened by:** <@" + record.ownerId + ">\n**Claimed by:** " +
        (record.claimedBy ? "<@" + record.claimedBy + ">" : "Unassigned") + "\n**Created:** <t:" + Math.floor(new Date(record.createdAt).getTime()/1000) + ":F>");
    }
  }
);
