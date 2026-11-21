import type { Guild } from "discord.js";
import { prisma, audit } from "../../lib/db.js";
import { getConfig, clearConfigCache } from "../../lib/config.js";
import { hasPermission } from "../../lib/permissions.js";
import {
  containsSuspiciousLink,
  countMentions,
  hashMessage,
  isDuplicateMessage,
  isSpammy,
} from "../../lib/antifraud.js";
import { logger } from "../../lib/logger.js";

export async function recordAction(targetDiscordId: string, actorId: string, type: string, reason?: string, durationMinutes?: number) {
  const user = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
  if (!user) throw new Error("Target member not found");
  const member = await prisma.discordMember.findUnique({ where: { userId: user.id } });
  if (!member) throw new Error("Target member record not found");
  const action = await prisma.moderationAction.create({ data: { targetId: member.id, actorId, type: type as never, reason, durationMinutes } });
  await audit(actorId, `moderation.${type.toLowerCase()}`, "ModerationAction", action.id, { targetId: targetDiscordId, reason });
  return action;
}

export interface ModerationConfig {
  profanityFilter: boolean;
  profanityWords: string[];
  inviteFilter: boolean;
  maxMentions: number;
  spamWindowSeconds: number;
  spamMaxMessages: number;
  suspiciousLinkAction: "delete" | "flag";
}

export async function getModerationConfig(): Promise<ModerationConfig> {
  const defaults: ModerationConfig = {
    profanityFilter: true,
    profanityWords: [],
    inviteFilter: true,
    maxMentions: 5,
    spamWindowSeconds: 10,
    spamMaxMessages: 5,
    suspiciousLinkAction: "delete",
  };
  const stored = await getConfig<Partial<ModerationConfig>>("moderation", {});
  return { ...defaults, ...stored };
}

export interface MessageFlags {
  spam: boolean;
  duplicate: boolean;
  suspiciousLink: boolean;
  massMention: boolean;
  invite: boolean;
  profanity: boolean;
}

/**
 * Pure message check against the configured rules. Returns which rules
 * fired; the caller decides the action. Uncertain scam classifications
 * only flag, they never auto-punish on their own.
 */
export function checkMessage(
  content: string,
  recentTimestamps: number[],
  recentHashes: string[],
  now: number,
  config: ModerationConfig,
): MessageFlags {
  const lowered = content.toLowerCase();
  return {
    spam: isSpammy(recentTimestamps, now, config.spamWindowSeconds * 1000, config.spamMaxMessages),
    duplicate: isDuplicateMessage(recentHashes, hashMessage(content)),
    suspiciousLink: containsSuspiciousLink(content),
    massMention: countMentions(content) > config.maxMentions,
    invite: config.inviteFilter && /discord\.gg\/|discord\.com\/invite\//i.test(content),
    profanity:
      config.profanityFilter &&
      config.profanityWords.some((word) => word.length > 0 && lowered.includes(word.toLowerCase())),
  };
}

async function requireModeration(actorId: string): Promise<void> {
  if (!(await hasPermission(actorId, "moderation.action"))) {
    throw new Error("You do not have permission to take moderation actions");
  }
}

async function fetchGuildMember(guild: Guild | undefined, discordId: string) {
  if (!guild) return null;
  return guild.members.fetch(discordId).catch(() => null);
}

/** Warn a member and record it. No Discord punishment is applied. */
export async function warnMember(targetDiscordId: string, actorId: string, reason: string, guild?: Guild) {
  await requireModeration(actorId);
  const action = await recordAction(targetDiscordId, actorId, "WARN", reason);
  const member = await fetchGuildMember(guild, targetDiscordId);
  if (member) {
    await member.send(`You received a warning in Overland Finance: ${reason}`).catch(() => undefined);
  }
  return action;
}

/** Timeout a member for the given minutes and record it. */
export async function timeoutMember(targetDiscordId: string, actorId: string, minutes: number, reason: string, guild?: Guild) {
  await requireModeration(actorId);
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > 40320) {
    throw new Error("Timeout must be between 1 minute and 28 days (40320 minutes)");
  }
  const member = await fetchGuildMember(guild, targetDiscordId);
  if (member) {
    await member.timeout(minutes * 60 * 1000, reason).catch((err) => {
      logger.warn({ err }, "Discord timeout failed, recording action anyway");
    });
  }
  return recordAction(targetDiscordId, actorId, "TIMEOUT", reason, minutes);
}

/** Kick a member and record it. */
export async function kickMember(targetDiscordId: string, actorId: string, reason: string, guild?: Guild) {
  await requireModeration(actorId);
  const member = await fetchGuildMember(guild, targetDiscordId);
  if (member) await member.kick(reason).catch((err) => logger.warn({ err }, "Discord kick failed"));
  return recordAction(targetDiscordId, actorId, "KICK", reason);
}

/** Ban a member and record it. */
export async function banMember(targetDiscordId: string, actorId: string, reason: string, guild?: Guild) {
  await requireModeration(actorId);
  const member = await fetchGuildMember(guild, targetDiscordId);
  if (guild) {
    await guild.members.ban(targetDiscordId, { reason }).catch((err) => logger.warn({ err }, "Discord ban failed"));
  } else if (member) {
    await member.ban({ reason }).catch(() => undefined);
  }
  return recordAction(targetDiscordId, actorId, "BAN", reason);
}

/** Unban a member by Discord id and record it. */
export async function unbanMember(targetDiscordId: string, actorId: string, reason: string, guild?: Guild) {
  await requireModeration(actorId);
  if (guild) await guild.members.unban(targetDiscordId, reason).catch((err) => logger.warn({ err }, "Discord unban failed"));
  return recordAction(targetDiscordId, actorId, "UNBAN", reason);
}

/** Full moderation history for one member, newest first. */
export async function getModerationHistory(targetDiscordId: string) {
  const user = await prisma.user.findUnique({ where: { discordId: targetDiscordId } });
  if (!user) return [];
  const member = await prisma.discordMember.findUnique({ where: { userId: user.id } });
  if (!member) return [];
  return prisma.moderationAction.findMany({ where: { targetId: member.id }, orderBy: { createdAt: "desc" } });
}

/** Is lockdown currently active (stored in BotConfiguration). */
export async function isLockdownActive(): Promise<boolean> {
  const config = await getModerationConfig();
  return (config as unknown as Record<string, unknown>).lockdown === true;
}

/** Update validated automatic moderation thresholds. */
export async function updateModerationConfig(actorId: string, patch: Partial<Pick<ModerationConfig,
  "profanityFilter" | "inviteFilter" | "maxMentions" | "spamWindowSeconds" | "spamMaxMessages" | "suspiciousLinkAction">>) {
  await requireModeration(actorId);
  const current = await getModerationConfig();
  const cleanPatch = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined)) as Partial<Pick<ModerationConfig, "profanityFilter" | "inviteFilter" | "maxMentions" | "spamWindowSeconds" | "spamMaxMessages" | "suspiciousLinkAction">>;
  const next = { ...current, ...cleanPatch };
  if (!Number.isInteger(next.maxMentions) || next.maxMentions < 1 || next.maxMentions > 50) throw new Error("Mention limit must be between 1 and 50.");
  if (!Number.isInteger(next.spamWindowSeconds) || next.spamWindowSeconds < 2 || next.spamWindowSeconds > 60) throw new Error("Spam window must be between 2 and 60 seconds.");
  if (!Number.isInteger(next.spamMaxMessages) || next.spamMaxMessages < 3 || next.spamMaxMessages > 20) throw new Error("Spam threshold must be between 3 and 20 messages.");
  await prisma.botConfiguration.upsert({
    where: { key: "moderation" },
    update: { value: next as never, updatedBy: actorId },
    create: { key: "moderation", value: next as never, updatedBy: actorId },
  });
  clearConfigCache("moderation");
  await audit(actorId, "moderation.config_update", "BotConfiguration", "moderation", cleanPatch as Record<string, unknown>);
  return next;
}

type LockdownSnapshot = Record<string, "allow" | "deny" | "inherit">;

/**
 * Lockdown records each channel's prior @everyone SendMessages overwrite.
 * Disabling lockdown restores those exact values instead of blindly making
 * every channel inherit permissions.
 */
export async function lockdownOn(actorId: string, guild?: Guild) {
  await requireModeration(actorId);
  const config = await getModerationConfig() as ModerationConfig & { lockdown?: boolean; lockdownOverwrites?: LockdownSnapshot };
  if (config.lockdown) return;
  const snapshot: LockdownSnapshot = {};
  if (guild) {
    const everyone = guild.roles.everyone;
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    for (const [, channel] of channels) {
      if (!channel || !channel.isTextBased() || !("permissionOverwrites" in channel)) continue;
      const overwrite = (channel as import("discord.js").GuildChannel).permissionOverwrites.cache.get(everyone.id);
      snapshot[channel.id] = overwrite?.allow.has("SendMessages") ? "allow" : overwrite?.deny.has("SendMessages") ? "deny" : "inherit";
    }
  }
  // Persist the rollback snapshot before changing Discord permissions.
  await prisma.botConfiguration.upsert({
    where: { key: "moderation" },
    update: { value: { ...config, lockdown: true, lockdownOverwrites: snapshot } as never, updatedBy: actorId },
    create: { key: "moderation", value: { ...config, lockdown: true, lockdownOverwrites: snapshot } as never, updatedBy: actorId },
  });
  clearConfigCache("moderation");
  if (guild) {
    const everyone = guild.roles.everyone;
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    for (const [channelId] of Object.entries(snapshot)) {
      const channel = channels.get(channelId);
      if (channel && channel.isTextBased() && "permissionOverwrites" in channel) {
        await (channel as import("discord.js").GuildChannel).permissionOverwrites.edit(everyone, { SendMessages: false }).catch((err) =>
          logger.warn({ err, channelId }, "Could not apply lockdown to channel"));
      }
    }
  }
  await audit(actorId, "moderation.lockdown_on", "BotConfiguration", "moderation", { channels: Object.keys(snapshot).length });
}

export async function lockdownOff(actorId: string, guild?: Guild) {
  await requireModeration(actorId);
  const config = await getModerationConfig() as ModerationConfig & { lockdown?: boolean; lockdownOverwrites?: LockdownSnapshot };
  const snapshot = config.lockdownOverwrites ?? {};
  if (guild) {
    const everyone = guild.roles.everyone;
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    for (const [channelId, state] of Object.entries(snapshot)) {
      const channel = channels.get(channelId);
      if (!channel || !channel.isTextBased() || !("permissionOverwrites" in channel)) continue;
      await channel.permissionOverwrites.edit(everyone, {
        SendMessages: state === "allow" ? true : state === "deny" ? false : null,
      }).catch((err) => logger.warn({ err, channelId }, "Could not restore channel permissions after lockdown"));
    }
  }
  const { lockdownOverwrites: _snapshot, ...rest } = config;
  await prisma.botConfiguration.upsert({
    where: { key: "moderation" },
    update: { value: { ...rest, lockdown: false } as never, updatedBy: actorId },
    create: { key: "moderation", value: { ...rest, lockdown: false } as never, updatedBy: actorId },
  });
  clearConfigCache("moderation");
  await audit(actorId, "moderation.lockdown_off", "BotConfiguration", "moderation", { restoredChannels: Object.keys(snapshot).length });
}
