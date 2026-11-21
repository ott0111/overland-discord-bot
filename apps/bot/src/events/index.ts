import { Events, type Client, type GuildMember, type PartialGuildMember, type Message, type Invite } from "discord.js";
import { prisma, audit } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { overlandEmbed } from "../lib/embeds.js";
import { hashMessage } from "../lib/antifraud.js";
import { awardParticipation } from "../modules/economy/service.js";
import { checkProgression } from "../modules/roles/service.js";
import { getModerationConfig, checkMessage } from "../modules/moderation/service.js";
import { getWelcomeSettings } from "../modules/settings/service.js";
import { recordJoin } from "../modules/referrals/service.js";

const recentByUser = new Map<string, number[]>();
const hashesByUser = new Map<string, string[]>();
const inviteUses = new Map<string, number>();

function inviteCacheKey(guildId: string, code: string): string { return guildId + ":" + code; }

async function refreshInvites(client: Client): Promise<void> {
  for (const guild of client.guilds.cache.values()) {
    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) continue;
    for (const invite of invites.values()) inviteUses.set(inviteCacheKey(guild.id, invite.code), invite.uses ?? 0);
  }
}

export function registerEvents(client: Client): void {
  client.once(Events.ClientReady, async (c) => {
    logger.info("Overland Core ready as " + c.user.tag);
    await refreshInvites(client);
  });

  client.on(Events.InviteCreate, (invite: Invite) => {
    if (invite.guild) inviteUses.set(inviteCacheKey(invite.guild.id, invite.code), invite.uses ?? 0);
  });
  client.on(Events.InviteDelete, (invite: Invite) => {
    if (invite.guild) inviteUses.delete(inviteCacheKey(invite.guild.id, invite.code));
  });

  client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
    try {
      const user = await prisma.user.upsert({
        where: { discordId: member.id },
        update: { username: member.user.username },
        create: { discordId: member.id, username: member.user.username },
      });
      await prisma.discordMember.upsert({
        where: { userId: user.id },
        update: { joinedAt: member.joinedAt },
        create: { userId: user.id, guildId: member.guild.id, joinedAt: member.joinedAt },
      });

      const accountAgeDays = (Date.now() - member.user.createdTimestamp) / 86400000;
      if (accountAgeDays < 7) {
        await prisma.discordMember.updateMany({ where: { userId: user.id }, data: { isSuspicious: true } });
      }

      const currentInvites = await member.guild.invites.fetch().catch(() => null);
      if (currentInvites) {
        const used = currentInvites.find((invite) =>
          (invite.uses ?? 0) > (inviteUses.get(inviteCacheKey(member.guild.id, invite.code)) ?? 0));
        for (const invite of currentInvites.values()) inviteUses.set(inviteCacheKey(member.guild.id, invite.code), invite.uses ?? 0);
        if (used) {
          // Bot-created invite links have the bot as their Discord inviter,
          // so resolve the actual member owner from our persisted invite map.
          const ownedInvite = await prisma.referralInvite.findUnique({
            where: { inviteCode: used.code },
            include: { member: { include: { user: true } } },
          });
          const referrerDiscordId = ownedInvite?.member.user.discordId ??
            (used.inviter && used.inviter.id !== client.user?.id ? used.inviter.id : null);

          if (referrerDiscordId && referrerDiscordId !== member.id) {
            const inviterUser = await prisma.user.upsert({
              where: { discordId: referrerDiscordId },
              update: { username: ownedInvite?.member.user.username ?? used.inviter?.username ?? "Unknown" },
              create: { discordId: referrerDiscordId, username: ownedInvite?.member.user.username ?? used.inviter?.username ?? "Unknown" },
            });
            await prisma.discordMember.upsert({
              where: { userId: inviterUser.id },
              update: {},
              create: { userId: inviterUser.id, guildId: member.guild.id },
            });
            await recordJoin(referrerDiscordId, member.id, used.code).catch((err) =>
              logger.warn({ err, inviteCode: used.code }, "Referral tracking failed"));
          }
        }
      }

      const welcome = await getWelcomeSettings();
      if (welcome.enabled) {
        const channel = welcome.channelId
          ? await member.guild.channels.fetch(welcome.channelId).catch(() => null)
          : null;
        const title = welcome.title.replaceAll("{user}", member.user.username).replaceAll("{server}", member.guild.name);
        const message = welcome.message.replaceAll("{user}", "<@" + member.id + ">").replaceAll("{server}", member.guild.name);
        const welcomeEmbed = overlandEmbed(title, message).setThumbnail(member.user.displayAvatarURL());
        if (channel?.isTextBased() && "send" in channel) {
          await (channel as import("discord.js").TextChannel).send({ embeds: [welcomeEmbed] });
        }
        if (welcome.sendDm) {
          await member.send({ embeds: [welcomeEmbed] }).catch((err) =>
            logger.debug({ err, memberId: member.id }, "Welcome DM could not be delivered"));
        }
      }
      await audit(null, "member.join", "DiscordMember", member.id, { accountAgeDays: Math.round(accountAgeDays) });
    } catch (err) {
      logger.error({ err }, "GuildMemberAdd failed");
    }
  });

  client.on(Events.GuildMemberUpdate, async (oldMember: GuildMember | PartialGuildMember, newMember: GuildMember) => {
    try {
      const managedRoles = await prisma.role.findMany({
        where: { isInternal: false, discordRoleId: { not: null } },
      });
      const changedRoles = managedRoles.filter((role) =>
        oldMember.roles.cache.has(role.discordRoleId!) !== newMember.roles.cache.has(role.discordRoleId!),
      );
      if (changedRoles.length === 0) return;

      const user = await prisma.user.findUnique({ where: { discordId: newMember.id } });
      const member = user
        ? await prisma.discordMember.findUnique({ where: { userId: user.id } })
        : null;

      for (const role of changedRoles) {
        const shouldHave = member
          ? Boolean(await prisma.memberRole.findUnique({
              where: { memberId_roleId: { memberId: member.id, roleId: role.id } },
            }))
          : false;
        const currentlyHas = newMember.roles.cache.has(role.discordRoleId!);
        if (shouldHave === currentlyHas) continue;

        if (shouldHave) {
          await newMember.roles.add(role.discordRoleId!, "Restore Overland-managed role from the member role ledger");
        } else {
          await newMember.roles.remove(role.discordRoleId!, "Remove role not authorized by the Overland role ledger");
        }

        if (member) {
          await prisma.roleHistory.create({
            data: {
              memberId: member.id,
              roleId: role.id,
              action: shouldHave ? "RESTORE_UNAUTHORIZED_CHANGE" : "REVOKE_UNAUTHORIZED_CHANGE",
              actorId: null,
              reason: "Discord role change did not match the Overland role ledger",
            },
          }).catch(() => undefined);
        }
        await audit(null, "roles.unauthorized_discord_change", "Role", role.id, {
          discordId: newMember.id,
          roleName: role.name,
          restored: shouldHave,
        });
      }
    } catch (err) {
      logger.error({ err, memberId: newMember.id }, "Could not enforce Overland-managed role state");
    }
  });

  client.on(Events.MessageCreate, async (msg: Message) => {
    if (msg.author.bot || !msg.guild || !msg.member) return;
    try {
      const now = Date.now();
      const timestamps = recentByUser.get(msg.author.id) ?? [];
      timestamps.push(now);
      const recent = timestamps.filter((time) => now - time < 60000);
      recentByUser.set(msg.author.id, recent);

      const hash = hashMessage(msg.content);
      const hashes = hashesByUser.get(msg.author.id) ?? [];
      const config = await getModerationConfig();
      const flags = checkMessage(msg.content, recent, hashes, now, config);

      if (flags.suspiciousLink) {
        await audit(null, "moderation.suspicious_link", "Message", msg.id, { authorId: msg.author.id, action: config.suspiciousLinkAction });
        if (config.suspiciousLinkAction === "delete") {
          await msg.delete().catch(() => undefined);
          await (msg.channel as import("discord.js").TextChannel).send({ embeds: [overlandEmbed("Link removed", "A suspicious link was removed automatically. Staff have been notified.")] }).catch(() => undefined);
          return;
        }
      }
      if (flags.invite || flags.massMention || flags.profanity) {
        await msg.delete().catch(() => undefined);
        await audit(null, "moderation.message_filtered", "Message", msg.id, {
          authorId: msg.author.id, invite: flags.invite, massMention: flags.massMention, profanity: flags.profanity,
        });
        return;
      }
      if (flags.spam) {
        await msg.member.timeout(60000, "Overland automatic spam protection").catch(() => undefined);
        await audit(null, "moderation.spam_timeout", "DiscordMember", msg.author.id, { windowSeconds: config.spamWindowSeconds });
        return;
      }
      if (flags.duplicate) return;

      hashes.push(hash);
      hashesByUser.set(msg.author.id, hashes.slice(-20));
      if (msg.content.trim().length < 20) return;

      const user = await prisma.user.findUnique({ where: { discordId: msg.author.id } });
      if (!user) return;
      const member = await prisma.discordMember.findUnique({ where: { userId: user.id } });
      if (!member) return;
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const earned = await prisma.pointTransaction.count({
        where: { memberId: member.id, source: "PARTICIPATION", createdAt: { gte: today } },
      });
      if (earned < 10) {
        const award = await awardParticipation(member.id, msg.id).catch((err) => {
          logger.warn({ err, memberId: member.id }, "Participation reward was not issued");
          return null;
        });
        if (award && !award.duplicate) {
          await checkProgression(member.id, "system", msg.guild).catch((err) =>
            logger.warn({ err, memberId: member.id }, "Role progression check failed"));
        }
      }
    } catch (err) {
      logger.error({ err }, "MessageCreate handler failed");
    }
  });
}
