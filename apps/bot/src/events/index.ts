
import { Events, type Client, type GuildMember, type Message } from "discord.js";
import { prisma, audit } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { overlandEmbed } from "../lib/embeds.js";
import { containsSuspiciousLink, countMentions, hashMessage, isSpammy } from "../lib/antifraud.js";
import { awardPoints } from "../lib/points.js";
const recentByUser = new Map<string, number[]>();
const hashesByUser = new Map<string, string[]>();
export function registerEvents(client: Client): void {
  client.once(Events.ClientReady, (c) => logger.info(`Overland Core ready as ${c.user.tag}`));
  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      const user = await prisma.user.upsert({ where: { discordId: member.id }, update: { username: member.user.username }, create: { discordId: member.id, username: member.user.username } });
      await prisma.discordMember.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, guildId: member.guild.id, joinedAt: member.joinedAt } });
      const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86400000;
      if (accountAgeDays < 7) await prisma.discordMember.updateMany({ where: { userId: user.id }, data: { isSuspicious: true } });
      const cfg = await prisma.botConfiguration.findUnique({ where: { key: "welcome" } });
      const welcomeChannelId = (cfg?.value as { channelId?: string } | null)?.channelId;
      if (welcomeChannelId) { const ch = await member.guild.channels.fetch(welcomeChannelId).catch(() => null); if (ch?.isTextBased()) await (ch as import("discord.js").TextChannel).send({ embeds: [overlandEmbed(`Welcome, ${member.user.username}`, "Welcome to Overland Finance. Complete verification to become a Citizen and unlock the community.")] }); }
      await audit(null, "member.join", "DiscordMember", member.id, { accountAgeDays: Math.round(accountAgeDays) });
    } catch (err) { logger.error({ err }, "GuildMemberAdd failed"); }
  });
  client.on(Events.MessageCreate, async (msg: Message) => {
    if (msg.author.bot || !msg.guild) return;
    try {
      if (containsSuspiciousLink(msg.content)) { await msg.delete().catch(() => undefined); await (msg.channel as import("discord.js").TextChannel).send({ embeds: [overlandEmbed("Link removed", "A suspicious link was removed automatically. Staff have been notified.")] }).catch(() => undefined); await audit(null, "moderation.link_removed", "Message", msg.id, { authorId: msg.author.id }); return; }
      if (countMentions(msg.content) > 5) { await msg.delete().catch(() => undefined); return; }
      const now = Date.now(); const arr = recentByUser.get(msg.author.id) ?? [];
      arr.push(now); recentByUser.set(msg.author.id, arr.filter((t) => now - t < 10000));
      if (isSpammy(arr, now, 10000, 5)) { await msg.member?.timeout(60_000, "Spam protection").catch(() => undefined); return; }
      const h = hashMessage(msg.content); const hashes = hashesByUser.get(msg.author.id) ?? [];
      if (hashes.includes(h)) return; hashes.push(h); hashesByUser.set(msg.author.id, hashes.slice(-20));
      if (msg.content.trim().length < 20) return;
      const user = await prisma.user.findUnique({ where: { discordId: msg.author.id } });
      if (!user) return; const member = await prisma.discordMember.findUnique({ where: { userId: user.id } });
      if (!member) return;
      const today = new Date(); today.setHours(0,0,0,0);
      const earned = await prisma.pointTransaction.count({ where: { memberId: member.id, source: "PARTICIPATION", createdAt: { gte: today } } });
      if (earned < 10) await awardPoints({ memberId: member.id, currency: "OVERPOINTS", category: "community", amount: 2, source: "PARTICIPATION", reason: "Meaningful participation", idempotencyKey: `msg-${msg.id}` }).catch(() => undefined);
    } catch (err) { logger.error({ err }, "MessageCreate handler failed"); }
  });
}
