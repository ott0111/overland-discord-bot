import { ChannelType, PermissionsBitField, type Guild, type GuildMember } from "discord.js";
import { prisma, audit } from "../../lib/db.js";
import { getConfig } from "../../lib/config.js";
import { hasPermission } from "../../lib/permissions.js";
import { logger } from "../../lib/logger.js";

export function transcriptText(messages: Array<{ authorId: string; content: string; createdAt: Date }>): string {
  return messages.map((m) => `[${m.createdAt.toISOString()}] ${m.authorId}: ${m.content}`).join("\n");
}

/**
 * Pure ticket numbering, unit tested without a database. Ticket numbers
 * are assigned by the database (SERIAL, see prisma/migrations), so this
 * helper only predicts the next number from the highest one seen and
 * formats a number for display. It never assigns a number itself, so it
 * cannot create a duplicate.
 */
export function nextTicketNumber(lastNumber: number | null | undefined): number {
  return (lastNumber ?? 0) + 1;
}

/** Display form of a ticket number: 1 becomes #0001, 42 becomes #0042. */
export function formatTicketNumber(n: number): string {
  return `#${String(Math.max(0, Math.floor(n))).padStart(4, "0")}`;
}

export const TICKET_CATEGORIES = [
  "General Inquiry",
  "Partnerships",
  "Business Development",
  "Opportunities",
  "Technical Support",
  "Other",
] as const;

async function ticketConfig() {
  return getConfig<{ staffRoleId?: string | null; categoryChannelId?: string | null }>("tickets", {});
}

async function resolveMemberByDiscordId(discordId: string) {
  const user = await prisma.user.findUnique({ where: { discordId } });
  if (!user) throw new Error("Member not found");
  const member = await prisma.discordMember.findUnique({ where: { userId: user.id } });
  if (!member) throw new Error("Member record not found");
  return member;
}

/**
 * Create a ticket: a DB record (numbered by autoincrement) plus, when a
 * guild is supplied, a private Discord channel visible only to the
 * member, staff, and the bot. Without a guild the record is still created
 * so the dashboard can create the channel later.
 */
export async function createTicketChannel(
  guild: Guild | null,
  memberDiscordId: string,
  category: string,
  topic: string,
) {
  if (!TICKET_CATEGORIES.includes(category as (typeof TICKET_CATEGORIES)[number])) {
    throw new Error(`Unknown ticket category: ${category}`);
  }
  const member = await resolveMemberByDiscordId(memberDiscordId);
  const open = await prisma.ticket.findFirst({ where: { memberId: member.id, status: { in: ["OPEN", "CLAIMED"] as never } } });
  if (open) throw new Error(`You already have an open ticket (#${open.number})`);
  const ticket = await prisma.ticket.create({ data: { category, memberId: member.id } });
  await prisma.ticketMessage.create({ data: { ticketId: ticket.id, authorId: memberDiscordId, content: topic } });
  if (!guild) return { ticket, channelId: null };
  const config = await ticketConfig();
  try {
    const channel = await guild.channels.create({
      name: `ticket-${ticket.number}`,
      type: ChannelType.GuildText,
      parent: config.categoryChannelId ?? undefined,
      topic: `${category}: ${topic}`.slice(0, 1024),
      permissionOverwrites: [
        { id: guild.roles.everyone.id, deny: [PermissionsBitField.Flags.ViewChannel] },
        {
          id: memberDiscordId,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
        },
        ...(guild.client.user ? [{
          id: guild.client.user.id,
          allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
        }] : []),
        ...(config.staffRoleId
          ? [
              {
                id: config.staffRoleId,
                allow: [PermissionsBitField.Flags.ViewChannel, PermissionsBitField.Flags.SendMessages, PermissionsBitField.Flags.ReadMessageHistory],
              },
            ]
          : []),
      ],
    });
    await prisma.ticket.update({ where: { id: ticket.id }, data: { channelId: channel.id } });
    await channel.send(
      `Ticket #${ticket.number} (${category}) opened by <@${memberDiscordId}>.\nTopic: ${topic}\nStaff will respond here. Use /ticket-close when resolved.`,
    );
    return { ticket, channelId: channel.id };
  } catch (err) {
    logger.error({ err, ticketId: ticket.id }, "Failed to create ticket channel, ticket record kept");
    return { ticket, channelId: null };
  }
}

/** Staff only. Claim a ticket so one person owns the response. */
export async function claimTicket(ticketId: string, staffDiscordId: string) {
  if (!(await hasPermission(staffDiscordId, "tickets.manage"))) {
    throw new Error("You do not have permission to manage tickets");
  }
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.status === "CLOSED" || ticket.status === "ARCHIVED") throw new Error("Ticket is already closed");
  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "CLAIMED", claimedBy: staffDiscordId },
  });
  await audit(staffDiscordId, "tickets.claim", "Ticket", ticketId, { number: ticket.number });
  return updated;
}

/** Record the first staff response, used for response-time tracking. */
export async function recordFirstResponse(ticketId: string, staffDiscordId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || ticket.firstResponseAt) return ticket;
  return prisma.ticket.update({
    where: { id: ticketId },
    data: { firstResponseAt: new Date() },
  });
}

/** Response time in milliseconds, or null when no staff response yet. */
export function responseTimeMs(ticket: { createdAt: Date; firstResponseAt: Date | null }): number | null {
  if (!ticket.firstResponseAt) return null;
  return ticket.firstResponseAt.getTime() - ticket.createdAt.getTime();
}

/**
 * Close a ticket: builds a transcript from stored messages, stores it in
 * the audit log, marks the ticket CLOSED, and deletes the private channel
 * when a guild is supplied. Returns the ticket plus its transcript.
 */
export async function closeTicket(ticketId: string, actorId: string, guild?: Guild) {
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.status === "CLOSED" || ticket.status === "ARCHIVED") throw new Error("Ticket is already closed");
  const transcript = transcriptText(ticket.messages);
  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "CLOSED", closedAt: new Date() },
  });
  await audit(actorId, "tickets.close", "Ticket", ticketId, {
    number: ticket.number,
    transcript: transcript.slice(0, 4000),
    messageCount: ticket.messages.length,
  });
  if (guild && ticket.channelId) {
    const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
    if (channel) {
      await channel.delete(`Ticket #${ticket.number} closed by ${actorId}`).catch((err) => logger.warn({ err }, "Ticket channel delete failed"));
    }
  }
  return { ticket: updated, transcript };
}

/** Archive a closed ticket so it leaves the active queue but stays searchable. */
export async function archiveTicket(ticketId: string, actorId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.status !== "CLOSED") throw new Error("Only closed tickets can be archived");
  return prisma.ticket.update({ where: { id: ticketId }, data: { status: "ARCHIVED" } });
}

/** Reopen a closed ticket. */
export async function reopenTicket(ticketId: string, actorId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error("Ticket not found");
  if (ticket.status !== "CLOSED") throw new Error("Only closed tickets can be reopened");
  const updated = await prisma.ticket.update({
    where: { id: ticketId },
    data: { status: "OPEN", closedAt: null, claimedBy: null },
  });
  await audit(actorId, "tickets.reopen", "Ticket", ticketId, { number: ticket.number });
  return updated;
}

/** Add a Discord member to a ticket channel. */
export async function addMember(ticketId: string, guild: Guild, discordId: string, actorId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || !ticket.channelId) throw new Error("Ticket channel not found");
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased() || !("permissionOverwrites" in channel)) throw new Error("Ticket channel not found");
  await channel.permissionOverwrites.edit(discordId, {
    ViewChannel: true,
    SendMessages: true,
    ReadMessageHistory: true,
  });
  await audit(actorId, "tickets.add_member", "Ticket", ticketId, { discordId });
}

/** Remove a Discord member from a ticket channel. */
export async function removeMember(ticketId: string, guild: Guild, discordId: string, actorId: string) {
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket || !ticket.channelId) throw new Error("Ticket channel not found");
  const channel = await guild.channels.fetch(ticket.channelId).catch(() => null);
  if (!channel?.isTextBased() || !("permissionOverwrites" in channel)) throw new Error("Ticket channel not found");
  await channel.permissionOverwrites.delete(discordId);
  await audit(actorId, "tickets.remove_member", "Ticket", ticketId, { discordId });
}

/** Member rates a closed ticket, 1 to 5. */
export async function rateTicket(ticketId: string, memberDiscordId: string, rating: number) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error("Rating must be a whole number from 1 to 5");
  const ticket = await prisma.ticket.findUnique({ where: { id: ticketId } });
  if (!ticket) throw new Error("Ticket not found");
  const member = await resolveMemberByDiscordId(memberDiscordId);
  if (ticket.memberId !== member.id) throw new Error("Only the ticket owner can rate it");
  if (ticket.status !== "CLOSED") throw new Error("Only closed tickets can be rated");
  return prisma.ticket.update({ where: { id: ticketId }, data: { rating } });
}

/** Store a message in a ticket thread (used by the message listener). */
export async function addTicketMessage(ticketId: string, authorDiscordId: string, content: string) {
  return prisma.ticketMessage.create({ data: { ticketId, authorId: authorDiscordId, content } });
}

/** Open tickets for the staff queue, oldest first. */
export async function listOpenTickets(take = 50) {
  return prisma.ticket.findMany({
    where: { status: { in: ["OPEN", "CLAIMED"] as never } },
    orderBy: { createdAt: "asc" },
    take,
    include: { member: { include: { user: true } } },
  });
}

/** Find a ticket by its Discord channel id (used by /ticket-close in-channel). */
export async function findTicketByChannel(channelId: string) {
  return prisma.ticket.findUnique({ where: { channelId } });
}

export type { GuildMember };
