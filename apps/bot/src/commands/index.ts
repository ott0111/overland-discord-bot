import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, type ChatInputCommandInteraction, type SlashCommandOptionsOnlyBuilder, type SlashCommandSubcommandsOnlyBuilder } from "discord.js";
import { prisma, audit } from "../lib/db.js";
import { overlandEmbed, errorEmbed } from "../lib/embeds.js";
import { getBalance, awardPoints, computeDailyStreak } from "../lib/points.js";
import { getInfoContent, getConfig, clearConfigCache, setInfoContent } from "../lib/config.js";
import { awardDailyCheckin } from "../modules/economy/service.js";
import { hasPermission } from "../lib/permissions.js";
import { listActive, submitWork, reviewSubmission } from "../modules/campaigns/service.js";
import { checkAndGrant, listMemberAchievements } from "../modules/achievements/service.js";
import { listRewards, claimReward, approveClaim, rejectClaim, fulfillClaim } from "../modules/rewards/service.js";
import { createTicketChannel, claimTicket, closeTicket, findTicketByChannel, formatTicketNumber } from "../modules/tickets/service.js";
import { getLeaderboard } from "../modules/leaderboards/service.js";
import { announceManual, getXConfig } from "../modules/x-integration/service.js";
import { getReferralStats } from "../modules/referrals/service.js";
import { staffVerify, startVerification, completeVerification } from "../modules/verification/service.js";
import { warnMember, timeoutMember } from "../modules/moderation/service.js";
import { assignRole, removeRole, listSelfAssignable, getRoleHistory, staffAward, setXFollowVerified, grantComrade, checkProgression } from "../modules/roles/service.js";
import { getSavedLinks, saveLink, removeLink, getWelcomeSettings, updateWelcomeSettings } from "../modules/settings/service.js";
import { getModerationConfig, updateModerationConfig, lockdownOn, lockdownOff, isLockdownActive, kickMember, banMember, unbanMember, getModerationHistory } from "../modules/moderation/service.js";

export interface Command { data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder; execute: (i: ChatInputCommandInteraction) => Promise<void>; }

async function ensureMember(discordId: string, username: string) {
  const user = await prisma.user.upsert({ where: { discordId }, update: { username }, create: { discordId, username } });
  return prisma.discordMember.upsert({ where: { userId: user.id }, update: {}, create: { userId: user.id, guildId: process.env.DISCORD_GUILD_ID ?? "" } });
}

async function replyInfo(i: ChatInputCommandInteraction, key: string, title: string) {
  await i.deferReply();
  await i.editReply({ embeds: [overlandEmbed(title, await getInfoContent(key))] });
}

async function requirePerm(i: ChatInputCommandInteraction, key: string): Promise<boolean> {
  if (await hasPermission(i.user.id, key)) return true;
  await i.reply({ ephemeral: true, embeds: [errorEmbed("You do not have permission for this.")] });
  return false;
}

function profileCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("profile").setDescription("View a member profile").addUserOption((o) => o.setName("member").setDescription("Member to view")),
    execute: async (i) => {
      await i.deferReply();
      const target = i.options.getUser("member") ?? i.user;
      const m = await ensureMember(target.id, target.username);
      const bal = await getBalance(m.id);
      const rank = await prisma.pointBalance.count({ where: { overpoints: { gt: bal.overpoints } } }) + 1;
      const refs = await prisma.referral.count({ where: { referrerId: m.id, verified: true } });
      const subs = await prisma.campaignSubmission.count({ where: { memberId: m.id, status: "APPROVED" } });
      const roles = await prisma.memberRole.findMany({ where: { memberId: m.id }, include: { role: true } });
      const latestCheckin = await prisma.dailyCheckin.findFirst({ where: { memberId: m.id }, orderBy: { date: "desc" } });
      const achievements = await listMemberAchievements(m.id);
      const joinedLabel = m.joinedAt ? m.joinedAt.toLocaleDateString("en-CA") : "Join date unavailable";
      const e = overlandEmbed(`${target.username} profile`, "Joined Overland: " + joinedLabel)
        .setThumbnail(target.displayAvatarURL())
        .addFields(
          { name: "Overpoints", value: String(bal.overpoints), inline: true },
          { name: "Overcredits", value: String(bal.overcredits), inline: true },
          { name: "Leaderboard rank", value: `#${rank}`, inline: true },
          { name: "Community", value: String(bal.communityPoints), inline: true },
          { name: "Social", value: String(bal.socialPoints), inline: true },
          { name: "Referral", value: String(bal.referralPoints), inline: true },
          { name: "Contribution", value: String(bal.contributionPoints), inline: true },
          { name: "Verified referrals", value: String(refs), inline: true },
          { name: "Approved submissions", value: String(subs), inline: true },
          { name: "Daily streak", value: latestCheckin ? `${latestCheckin.streak} day${latestCheckin.streak === 1 ? "" : "s"}` : "0 days", inline: true },
          { name: "Achievements", value: achievements.length ? achievements.map((a: { achievement: { name: string } }) => a.achievement.name).join(", ") : "None yet", inline: true },
          { name: "Roles", value: roles.map((r: { role: { name: string } }) => r.role.name).join(", ") || "Citizen (pending verification)" },
        );
      await i.editReply({ embeds: [e] });
    },
  };
}

function dailyCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("daily").setDescription("Daily check-in: earn Overpoints and build your streak"),
    execute: async (i) => {
      await i.deferReply({ ephemeral: true });
      const m = await ensureMember(i.user.id, i.user.username);
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const existing = await prisma.dailyCheckin.findUnique({ where: { memberId_date: { memberId: m.id, date: today } } });
      if (existing) {
        await i.editReply({ embeds: [overlandEmbed("Already checked in", "You have already checked in today. Come back tomorrow to keep your streak.")] });
        return;
      }
      const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1);
      const prev = await prisma.dailyCheckin.findUnique({ where: { memberId_date: { memberId: m.id, date: yesterday } } });
      const streak = computeDailyStreak(prev?.date ?? null, today, prev?.streak ?? 0);
      const award = await awardDailyCheckin(m.id, streak);
      await prisma.dailyCheckin.create({ data: { memberId: m.id, date: today, streak } });
      const newlyGranted = await checkAndGrant(m.id).catch(() => [] as string[]);
      await checkProgression(m.id, i.user.id, i.guild ?? undefined).catch(() => []);
      await i.editReply({ embeds: [overlandEmbed("Daily check-in complete", `Streak: ${streak} day${streak === 1 ? "" : "s"}. You earned ${award.amount} Overpoints${award.streakBonus > 0 ? " plus a " + award.streakBonus + " Overcredit streak bonus" : ""}.${newlyGranted.length ? ` Achievement unlocked: ${newlyGranted.join(", ")}.` : ""}`)] });
    },
  };
}

function leaderboardCmd(): Command {
  const cats = ["overall", "community", "social", "referrals", "contributions"] as const;
  return {
    data: new SlashCommandBuilder().setName("leaderboard").setDescription("View a leaderboard").addStringOption((o) => o.setName("category").setDescription("Category").setRequired(true).addChoices(...cats.map((c) => ({ name: c, value: c })))).addStringOption((o) => o.setName("period").setDescription("Period").addChoices({ name: "Lifetime", value: "LIFETIME" }, { name: "Monthly", value: "MONTHLY" }, { name: "Weekly", value: "WEEKLY" })).addIntegerOption((o) => o.setName("page").setDescription("Page number").setMinValue(1)),
    execute: async (i) => {
      await i.deferReply();
      const cat = i.options.getString("category", true);
      const period = (i.options.getString("period") ?? "LIFETIME") as "LIFETIME" | "MONTHLY" | "WEEKLY";
      const page = i.options.getInteger("page") ?? 1;
      const result = await getLeaderboard(cat, period, page, 10);
      const lines = result.rows.map((r) => `${r.rank}. ${r.username} - ${r.score} points`);
      await i.editReply({ embeds: [overlandEmbed(`${cat} leaderboard (${period.toLowerCase()}, page ${page})`, lines.join("\n") || "No entries yet.")] });
    },
  };
}

function simpleCmd(name: string, desc: string, fn: (i: ChatInputCommandInteraction) => Promise<void>): Command {
  return { data: new SlashCommandBuilder().setName(name).setDescription(desc), execute: fn };
}


function linkCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("link").setDescription("Manage Overland social and resource links")
      .addSubcommand((s) => s.setName("add").setDescription("Add or replace a saved link").addStringOption((o) => o.setName("name").setDescription("Button label").setRequired(true)).addStringOption((o) => o.setName("url").setDescription("HTTPS URL").setRequired(true)).addStringOption((o) => o.setName("key").setDescription("Stable key, optional")))
      .addSubcommand((s) => s.setName("edit").setDescription("Edit a saved link").addStringOption((o) => o.setName("key").setDescription("Existing link key").setRequired(true)).addStringOption((o) => o.setName("name").setDescription("New button label").setRequired(true)).addStringOption((o) => o.setName("url").setDescription("New HTTPS URL").setRequired(true)))
      .addSubcommand((s) => s.setName("remove").setDescription("Remove a saved link").addStringOption((o) => o.setName("key").setDescription("Link key").setRequired(true)))
      .addSubcommand((s) => s.setName("list").setDescription("List saved links")),
    execute: async (i) => {
      const action = i.options.getSubcommand();
      if (action === "list") {
        const links = await getSavedLinks();
        await i.reply({ ephemeral: true, embeds: [overlandEmbed("Saved links", links.map((x) => "**" + x.label + "** (" + x.key + ")\n" + x.url).join("\n") || "No links have been configured.")] });
        return;
      }
      await i.deferReply({ ephemeral: true });
      try {
        if (action === "remove") {
          const removed = await removeLink(i.user.id, i.options.getString("key", true));
          await i.editReply({ embeds: [overlandEmbed(removed ? "Link removed" : "Link not found", removed ? "The saved link was removed." : "No saved link matched that key.")] });
          return;
        }
        const label = i.options.getString("name", true);
        const url = i.options.getString("url", true);
        const key = action === "edit" ? i.options.getString("key", true) : i.options.getString("key") ?? label;
        const saved = await saveLink(i.user.id, label, url, key);
        await i.editReply({ embeds: [overlandEmbed("Link saved", "**" + saved.label + "** is now available in /socials.\nKey: " + saved.key)] });
      } catch (err) {
        await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Link update failed.")] });
      }
    },
  };
}
function socialsCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("socials").setDescription("View Overland's configured social links"),
    execute: async (i) => {
      const links = await getSavedLinks();
      const intro = await getInfoContent("socials");
      const linkList = links.slice(0, 25).map((x) => "**[" + x.label + "](" + x.url + ")**").join("\n");
      const description = [intro, linkList].filter(Boolean).join("\n\n").slice(0, 4000);
      const embed = overlandEmbed("Overland socials", description || "Social links have not been configured yet.");
      const rows: ActionRowBuilder<ButtonBuilder>[] = [];
      for (let n = 0; n < Math.min(links.length, 25); n += 5) {
        rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(...links.slice(n, n + 5).map((x) =>
          new ButtonBuilder().setLabel(x.label.slice(0, 80)).setURL(x.url).setStyle(ButtonStyle.Link))));
      }
      await i.reply({ embeds: [embed], components: rows });
    },
  };
}
function welcomeCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("welcome").setDescription("Configure the member welcome system")
      .addSubcommand((s) => s.setName("setup").setDescription("Set the welcome channel and message").addChannelOption((o) => o.setName("channel").setDescription("Welcome channel").setRequired(true).addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)).addStringOption((o) => o.setName("title").setDescription("Embed title; supports {user} and {server}")).addStringOption((o) => o.setName("message").setDescription("Welcome text; supports {user} and {server}")).addBooleanOption((o) => o.setName("enabled").setDescription("Enable welcome messages")))
      .addSubcommand((s) => s.setName("preview").setDescription("Preview the current welcome message")),
    execute: async (i) => {
      const config = await getWelcomeSettings();
      if (i.options.getSubcommand() === "preview") {
        const title = config.title.replaceAll("{user}", i.user.username).replaceAll("{server}", i.guild?.name ?? "Overland");
        const message = config.message.replaceAll("{user}", "<@" + i.user.id + ">").replaceAll("{server}", i.guild?.name ?? "Overland");
        await i.reply({ ephemeral: true, embeds: [overlandEmbed(title, message)] });
        return;
      }
      const channel = i.options.getChannel("channel", true) as unknown as import("discord.js").TextChannel;
      await i.deferReply({ ephemeral: true });
      try {
        const next = await updateWelcomeSettings(i.user.id, {
          channelId: channel.id,
          title: i.options.getString("title") ?? config.title,
          message: i.options.getString("message") ?? config.message,
          enabled: i.options.getBoolean("enabled") ?? config.enabled,
        });
        await i.editReply({ embeds: [overlandEmbed("Welcome system configured", "Channel: <#" + next.channelId + ">\nEnabled: " + (next.enabled ? "Yes" : "No") + "\nUse /welcome preview to check the message.")] });
      } catch (err) { await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Welcome setup failed.")] }); }
    },
  };
}
function setupCmd(): Command {
  const infoPages = ["about", "links", "team", "roadmap", "updates", "faq", "opportunities", "socials"];
  return {
    data: new SlashCommandBuilder().setName("setup").setDescription("Configure Overland community information and systems")
      .addStringOption((o) => o.setName("feature").setDescription("Feature or information page").setRequired(true).addChoices(
        { name: "Welcome messages", value: "welcome" }, { name: "Social links", value: "social_links" },
        { name: "Tickets", value: "tickets" }, { name: "Verification", value: "verification" },
        { name: "Security and moderation", value: "security" }, { name: "X announcements", value: "x" },
        { name: "About page", value: "about" }, { name: "Public team page", value: "team" },
        { name: "Roadmap page", value: "roadmap" }, { name: "Updates page", value: "updates" },
        { name: "FAQ page", value: "faq" }, { name: "Opportunities page", value: "opportunities" },
        { name: "Socials information", value: "socials" }))
      .addStringOption((o) => o.setName("content").setDescription("New public page content (leave empty to view)").setMaxLength(3500)),
    execute: async (i) => {
      const feature = i.options.getString("feature", true);
      const content = i.options.getString("content");
      if (infoPages.includes(feature)) {
        if (content !== null) {
          await i.deferReply({ ephemeral: true });
          try {
            await setInfoContent(i.user.id, feature, content);
            await i.editReply({ embeds: [overlandEmbed("Information page updated", "The /" + feature + " page now uses the new content.")] });
          } catch (err) {
            await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Information update failed.")] });
          }
          return;
        }
        await replyInfo(i, feature, "Setup: " + feature);
        return;
      }
      if (content !== null) {
        await i.reply({ ephemeral: true, embeds: [errorEmbed("The content option is only available for public information pages.")] });
        return;
      }
      const instructions: Record<string, string> = {
        welcome: "Run /welcome setup and choose a channel, title and message. Use {user} and {server} placeholders. Preview with /welcome preview.",
        social_links: "Add links with /link add, update them with /link edit, and publish them with /socials. Links must use HTTPS.",
        tickets: "Run /ticket-setup to set the staff role and private ticket category.",
        verification: "Run /verification-setup to configure account age, CAPTCHA and avatar requirements. Configure the Citizen role in the dashboard.",
        security: "Use /security status to inspect protections and /security lockdown to restrict server messaging during an incident.",
        x: "Run /x-setup to configure the username, announcement channel and polling. Add X_BEARER_TOKEN to the bot environment.",
      };
      await i.reply({ ephemeral: true, embeds: [overlandEmbed("Setup: " + feature, instructions[feature] ?? "See the deployment guide.")] });
    },
  };
}
function securityCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("security").setDescription("Inspect and control server security")
      .addSubcommand((s) => s.setName("status").setDescription("Show active security settings"))
      .addSubcommand((s) => s.setName("lockdown").setDescription("Enable or disable server lockdown").addStringOption((o) => o.setName("action").setDescription("Lockdown action").setRequired(true).addChoices({ name: "Enable", value: "enable" }, { name: "Disable", value: "disable" })))
      .addSubcommand((s) => s.setName("configure").setDescription("Change automatic moderation thresholds")
        .addIntegerOption((o) => o.setName("mention_limit").setDescription("Maximum mentions per message").setMinValue(1).setMaxValue(50))
        .addIntegerOption((o) => o.setName("spam_max_messages").setDescription("Messages that trigger spam protection").setMinValue(3).setMaxValue(20))
        .addIntegerOption((o) => o.setName("spam_window_seconds").setDescription("Spam detection window in seconds").setMinValue(2).setMaxValue(60))
        .addBooleanOption((o) => o.setName("invite_filter").setDescription("Automatically remove Discord invite links"))
        .addStringOption((o) => o.setName("suspicious_link_action").setDescription("Action for suspicious links").addChoices({ name: "Delete", value: "delete" }, { name: "Flag only", value: "flag" }))),
    execute: async (i) => {
      const sub = i.options.getSubcommand();
      if (sub === "status") {
        if (!(await requirePerm(i, "moderation.view"))) return;
        const cfg = await getModerationConfig();
        await i.reply({ ephemeral: true, embeds: [overlandEmbed("Security status", "Lockdown: " + (await isLockdownActive() ? "ACTIVE" : "Off") + "\nSpam threshold: " + cfg.spamMaxMessages + " messages / " + cfg.spamWindowSeconds + "s\nMention limit: " + cfg.maxMentions + "\nInvite filter: " + (cfg.inviteFilter ? "On" : "Off") + "\nSuspicious link filter: " + cfg.suspiciousLinkAction)] });
        return;
      }
      if (!(await requirePerm(i, "moderation.action"))) return;
      await i.deferReply({ ephemeral: true });
      try {
        if (sub === "lockdown") {
          const action = i.options.getString("action", true);
          if (action === "enable") await lockdownOn(i.user.id, i.guild ?? undefined);
          else await lockdownOff(i.user.id, i.guild ?? undefined);
          await i.editReply({ embeds: [overlandEmbed("Security updated", action === "enable" ? "Server lockdown is active. Existing channel permissions will be restored when it is disabled." : "Server lockdown has been disabled.")] });
          return;
        }
        const patch = {
          maxMentions: i.options.getInteger("mention_limit") ?? undefined,
          spamMaxMessages: i.options.getInteger("spam_max_messages") ?? undefined,
          spamWindowSeconds: i.options.getInteger("spam_window_seconds") ?? undefined,
          inviteFilter: i.options.getBoolean("invite_filter") ?? undefined,
          suspiciousLinkAction: (i.options.getString("suspicious_link_action") ?? undefined) as "delete" | "flag" | undefined,
        };
        if (Object.values(patch).every((value) => value === undefined)) {
          await i.editReply({ embeds: [errorEmbed("Provide at least one setting to change.")] });
          return;
        }
        const updated = await updateModerationConfig(i.user.id, patch);
        await i.editReply({ embeds: [overlandEmbed("Security settings saved", "Mention limit: " + updated.maxMentions + "\nSpam threshold: " + updated.spamMaxMessages + " / " + updated.spamWindowSeconds + "s\nInvite filter: " + (updated.inviteFilter ? "On" : "Off") + "\nSuspicious links: " + updated.suspiciousLinkAction)] });
      } catch (err) { await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Security action failed.")] }); }
    },
  };
}
function kickCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("kick").setDescription("Staff: remove a member from the server").addUserOption((o) => o.setName("member").setDescription("Member to kick").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),
    execute: async (i) => {
      if (!(await requirePerm(i, "moderation.action"))) return;
      await i.deferReply({ ephemeral: true });
      try {
        const target = i.options.getUser("member", true);
        await ensureMember(target.id, target.username);
        await kickMember(target.id, i.user.id, i.options.getString("reason", true), i.guild ?? undefined);
        await i.editReply({ embeds: [overlandEmbed("Member kicked", target.username + " was removed from the server.")] });
      } catch (err) { await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Kick failed.")] }); }
    },
  };
}
function banCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("ban").setDescription("Staff: ban a member from the server").addUserOption((o) => o.setName("member").setDescription("Member to ban").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),
    execute: async (i) => {
      if (!(await requirePerm(i, "moderation.action"))) return;
      await i.deferReply({ ephemeral: true });
      try {
        const target = i.options.getUser("member", true);
        await ensureMember(target.id, target.username);
        await banMember(target.id, i.user.id, i.options.getString("reason", true), i.guild ?? undefined);
        await i.editReply({ embeds: [overlandEmbed("Member banned", target.username + " was banned from the server.")] });
      } catch (err) { await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Ban failed.")] }); }
    },
  };
}
function unbanCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("unban").setDescription("Staff: unban a Discord user").addStringOption((o) => o.setName("user_id").setDescription("Discord user ID").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),
    execute: async (i) => {
      if (!(await requirePerm(i, "moderation.action"))) return;
      await i.deferReply({ ephemeral: true });
      try {
        const id = i.options.getString("user_id", true);
        if (!/^\d{17,20}$/.test(id)) throw new Error("Enter a valid Discord user ID.");
        const target = await i.client.users.fetch(id);
        await ensureMember(target.id, target.username);
        await unbanMember(target.id, i.user.id, i.options.getString("reason", true), i.guild ?? undefined);
        await i.editReply({ embeds: [overlandEmbed("Member unbanned", target.username + " has been unbanned.")] });
      } catch (err) { await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Unban failed.")] }); }
    },
  };
}
function modHistoryCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("mod-history").setDescription("Staff: view a member's moderation history").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)),
    execute: async (i) => {
      if (!(await requirePerm(i, "moderation.view"))) return;
      await i.deferReply({ ephemeral: true });
      const target = i.options.getUser("member", true);
      const history = await getModerationHistory(target.id);
      const lines = history.slice(0, 10).map((row: { type: string; reason: string | null; createdAt: Date; actorId: string }) =>
        row.type + " | " + (row.reason ?? "No reason") + " | " + row.createdAt.toISOString().slice(0, 10) + " | by " + row.actorId);
      await i.editReply({ embeds: [overlandEmbed("Moderation history: " + target.username, lines.join("\n") || "No recorded moderation actions.")] });
    },
  };
}
function purgeCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("purge").setDescription("Staff: bulk-delete recent messages").addIntegerOption((o) => o.setName("amount").setDescription("Number of messages (2-100)").setRequired(true).setMinValue(2).setMaxValue(100)),
    execute: async (i) => {
      if (!(await requirePerm(i, "moderation.action"))) return;
      const channel = i.channel;
      if (!channel || !channel.isTextBased() || !("bulkDelete" in channel)) { await i.reply({ ephemeral: true, embeds: [errorEmbed("This command only works in a text channel.")] }); return; }
      await i.deferReply({ ephemeral: true });
      try {
        const amount = i.options.getInteger("amount", true);
        const deleted = await (channel as import("discord.js").TextChannel).bulkDelete(amount, true);
        await audit(i.user.id, "moderation.purge", "Channel", channel.id, { requested: amount, deleted: deleted.size });
        await i.editReply({ embeds: [overlandEmbed("Messages deleted", "Deleted " + deleted.size + " recent messages. Discord does not bulk-delete messages older than 14 days.")] });
      } catch (err) { await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Purge failed.")] }); }
    },
  };
}


function ticketSetupCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("ticket-setup").setDescription("Configure private support tickets")
      .addRoleOption((o) => o.setName("staff_role").setDescription("Role allowed to view and answer tickets"))
      .addChannelOption((o) => o.setName("category").setDescription("Discord category for new ticket channels").addChannelTypes(ChannelType.GuildCategory)),
    execute: async (i) => {
      if (!(await requirePerm(i, "config.manage"))) return;
      const current = await getConfig<{ staffRoleId?: string | null; categoryChannelId?: string | null }>("tickets", {});
      const role = i.options.getRole("staff_role");
      const category = i.options.getChannel("category");
      const next = {
        staffRoleId: role?.id ?? current.staffRoleId ?? null,
        categoryChannelId: category?.id ?? current.categoryChannelId ?? null,
      };
      await prisma.botConfiguration.upsert({
        where: { key: "tickets" }, update: { value: next as never, updatedBy: i.user.id },
        create: { key: "tickets", value: next as never, updatedBy: i.user.id },
      });
      clearConfigCache("tickets");
      await audit(i.user.id, "settings.tickets_update", "BotConfiguration", "tickets", next);
      await i.reply({ ephemeral: true, embeds: [overlandEmbed("Ticket settings saved", "Staff role: " + (next.staffRoleId ? "<@&" + next.staffRoleId + ">" : "Not set") + "\nCategory: " + (next.categoryChannelId ? "<#" + next.categoryChannelId + ">" : "Not set"))] });
    },
  };
}
function verificationSetupCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("verification-setup").setDescription("Configure member verification")
      .addIntegerOption((o) => o.setName("minimum_account_age_days").setDescription("Minimum Discord account age").setMinValue(0).setMaxValue(365))
      .addBooleanOption((o) => o.setName("require_captcha").setDescription("Require the verification challenge"))
      .addBooleanOption((o) => o.setName("require_avatar").setDescription("Require a Discord avatar"))
      .addIntegerOption((o) => o.setName("anti_raid_window_minutes").setDescription("Anti-raid join window").setMinValue(1).setMaxValue(60))
      .addIntegerOption((o) => o.setName("anti_raid_threshold").setDescription("Joins in the window that pause verification").setMinValue(3).setMaxValue(100)),
    execute: async (i) => {
      if (!(await requirePerm(i, "config.manage"))) return;
      const current = await getConfig<{ minAccountAgeDays: number; requireCaptcha: boolean; requireAvatar?: boolean; antiRaidWindowMinutes?: number; antiRaidThreshold?: number }>("verification", {
        minAccountAgeDays: 7, requireCaptcha: true, requireAvatar: false, antiRaidWindowMinutes: 10, antiRaidThreshold: 10,
      });
      const patch = {
        minAccountAgeDays: i.options.getInteger("minimum_account_age_days") ?? current.minAccountAgeDays,
        requireCaptcha: i.options.getBoolean("require_captcha") ?? current.requireCaptcha,
        requireAvatar: i.options.getBoolean("require_avatar") ?? current.requireAvatar ?? false,
        antiRaidWindowMinutes: i.options.getInteger("anti_raid_window_minutes") ?? current.antiRaidWindowMinutes ?? 10,
        antiRaidThreshold: i.options.getInteger("anti_raid_threshold") ?? current.antiRaidThreshold ?? 10,
      };
      if (i.options.getInteger("minimum_account_age_days") === null &&
          i.options.getBoolean("require_captcha") === null && i.options.getBoolean("require_avatar") === null && i.options.getInteger("anti_raid_window_minutes") === null && i.options.getInteger("anti_raid_threshold") === null) {
        await i.reply({ ephemeral: true, embeds: [errorEmbed("Provide at least one verification setting to change.")] });
        return;
      }
      await prisma.botConfiguration.upsert({
        where: { key: "verification" }, update: { value: patch as never, updatedBy: i.user.id },
        create: { key: "verification", value: patch as never, updatedBy: i.user.id },
      });
      clearConfigCache("verification");
      await audit(i.user.id, "settings.verification_update", "BotConfiguration", "verification", patch);
      await i.reply({ ephemeral: true, embeds: [overlandEmbed("Verification settings saved", "Minimum account age: " + patch.minAccountAgeDays + " days\nCAPTCHA: " + (patch.requireCaptcha ? "Required" : "Disabled") + "\nAvatar: " + (patch.requireAvatar ? "Required" : "Optional") + "\nAnti-raid: " + patch.antiRaidThreshold + " joins / " + patch.antiRaidWindowMinutes + " minutes")] });
    },
  };
}
function xSetupCmd(): Command {
  return {
    data: new SlashCommandBuilder().setName("x-setup").setDescription("Configure X timeline announcements")
      .addStringOption((o) => o.setName("username").setDescription("X username without @"))
      .addChannelOption((o) => o.setName("channel").setDescription("Announcement channel").addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement))
      .addBooleanOption((o) => o.setName("enabled").setDescription("Enable automatic announcements"))
      .addIntegerOption((o) => o.setName("poll_minutes").setDescription("Polling interval in minutes").setMinValue(5).setMaxValue(1440))
      .addBooleanOption((o) => o.setName("ignore_replies").setDescription("Ignore replies"))
      .addBooleanOption((o) => o.setName("ignore_reposts").setDescription("Ignore reposts")),
    execute: async (i) => {
      if (!(await requirePerm(i, "x.manage"))) return;
      const current = await getXConfig();
      const username = i.options.getString("username") ?? current.username;
      if (!/^[A-Za-z0-9_]{1,15}$/.test(username)) {
        await i.reply({ ephemeral: true, embeds: [errorEmbed("Enter a valid X username without @.")] });
        return;
      }
      const channel = i.options.getChannel("channel");
      const next = {
        ...current, username,
        channelId: channel?.id ?? current.channelId,
        enabled: i.options.getBoolean("enabled") ?? current.enabled,
        pollMinutes: i.options.getInteger("poll_minutes") ?? current.pollMinutes,
        ignoreReplies: i.options.getBoolean("ignore_replies") ?? current.ignoreReplies,
        ignoreReposts: i.options.getBoolean("ignore_reposts") ?? current.ignoreReposts,
      };
      if (!i.options.getString("username") && !channel && i.options.getBoolean("enabled") === null &&
          i.options.getInteger("poll_minutes") === null && i.options.getBoolean("ignore_replies") === null &&
          i.options.getBoolean("ignore_reposts") === null) {
        await i.reply({ ephemeral: true, embeds: [errorEmbed("Provide at least one X setting to change.")] });
        return;
      }
      await prisma.botConfiguration.upsert({
        where: { key: "xIntegration" }, update: { value: next as never, updatedBy: i.user.id },
        create: { key: "xIntegration", value: next as never, updatedBy: i.user.id },
      });
      clearConfigCache("xIntegration");
      await audit(i.user.id, "settings.x_update", "BotConfiguration", "xIntegration", next);
      await i.reply({ ephemeral: true, embeds: [overlandEmbed("X integration settings saved", "Account: @" + next.username + "\nChannel: " + (next.channelId ? "<#" + next.channelId + ">" : "Not set") + "\nEnabled: " + (next.enabled ? "Yes" : "No") + "\nPoll interval: " + next.pollMinutes + " minutes\nReplies ignored: " + next.ignoreReplies + "\nReposts ignored: " + next.ignoreReposts)] });
    },
  };
}

export const commands: Command[] = [
  profileCmd(), dailyCmd(), leaderboardCmd(),
  simpleCmd("about", "About Overland Finance", (i) => replyInfo(i, "about", "About Overland Finance")),
  simpleCmd("links", "Official Overland links", (i) => replyInfo(i, "links", "Official links")),
  simpleCmd("team", "Meet the Overland team", (i) => replyInfo(i, "team", "Team")),
  simpleCmd("roadmap", "Overland roadmap", (i) => replyInfo(i, "roadmap", "Roadmap")),
  simpleCmd("updates", "Latest Overland updates", (i) => replyInfo(i, "updates", "Updates")),
  simpleCmd("faq", "Frequently asked questions", (i) => replyInfo(i, "faq", "FAQ")),
  simpleCmd("opportunities", "Open opportunities", (i) => replyInfo(i, "opportunities", "Opportunities")),
  socialsCmd(), linkCmd(), welcomeCmd(), setupCmd(), securityCmd(), kickCmd(), banCmd(), unbanCmd(), modHistoryCmd(), purgeCmd(), ticketSetupCmd(), verificationSetupCmd(), xSetupCmd(),
  { data: new SlashCommandBuilder().setName("help").setDescription("List Overland Core commands"), execute: async (i) => { await i.reply({ ephemeral: true, embeds: [overlandEmbed("Overland Core commands", commands.map((c: Command) => `/${c.data.name} - ${c.data.description}`).join("\n"))] }); } },
  { data: new SlashCommandBuilder().setName("invite").setDescription("Get your persistent personal referral invite link"), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    const member = await ensureMember(i.user.id, i.user.username);
    const guild = i.guild;
    if (!guild) { await i.editReply("Use this in the server."); return; }

    const invites = await guild.invites.fetch().catch(() => null);
    if (!invites) {
      await i.editReply({ embeds: [errorEmbed("I cannot read server invites. Staff need to grant Manage Server or Manage Guild invite access.")] });
      return;
    }

    const stored = await prisma.referralInvite.findFirst({
      where: { memberId: member.id, revokedAt: null },
      orderBy: { createdAt: "desc" },
    });
    const existing = stored ? invites.get(stored.inviteCode) : null;
    if (existing) {
      await i.editReply({ embeds: [overlandEmbed("Your referral invite", "Share your personal invite link:\n" + existing.url + "\n\nVerified joins through this link count toward your referral progress.")] });
      return;
    }

    if (stored) {
      await prisma.referralInvite.update({ where: { id: stored.id }, data: { revokedAt: new Date() } });
    }

    const channelId = i.channelId ?? guild.systemChannelId;
    if (!channelId) {
      await i.editReply({ embeds: [errorEmbed("No channel is available to create an invite.")] });
      return;
    }
    const invite = await guild.invites.create(channelId, {
      maxAge: 0,
      maxUses: 0,
      unique: true,
      reason: "Persistent Overland referral invite for " + i.user.username,
    }).catch(() => null);
    if (!invite) {
      await i.editReply({ embeds: [errorEmbed("Invite creation failed. Ask staff to check the bot's invite permissions.")] });
      return;
    }

    await prisma.referralInvite.create({ data: { memberId: member.id, inviteCode: invite.code } });
    await i.editReply({ embeds: [overlandEmbed("Your referral invite", "Share your personal invite link:\n" + invite.url + "\n\nVerified joins through this link count toward your referral progress.")] });
  } },
  { data: new SlashCommandBuilder().setName("referrals").setDescription("View your referral stats"), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    const m = await ensureMember(i.user.id, i.user.username);
    const stats = await getReferralStats(m.id);
    await i.editReply({ embeds: [overlandEmbed("Your referrals", `Total joins: ${stats.total}\nVerified: ${stats.verified}\nRetained 7 days: ${stats.retained7d}\nBecame Comrade: ${stats.becameComrade}`)] });
  } },
  { data: new SlashCommandBuilder().setName("campaigns").setDescription("List active campaigns"), execute: async (i) => {
    await i.deferReply();
    const list = await listActive();
    await i.editReply({ embeds: [overlandEmbed("Active campaigns", list.map((c: { name: string; pointReward: number; endsAt: Date; id: string }) => `${c.name} - ${c.pointReward} points (ends ${c.endsAt.toISOString().slice(0, 10)}, id: ${c.id})`).join("\n") || "No active campaigns right now.")] });
  } },
  { data: new SlashCommandBuilder().setName("campaign-info").setDescription("View a campaign").addStringOption((o) => o.setName("campaign").setDescription("Campaign ID").setRequired(true)), execute: async (i) => {
    await i.deferReply();
    const c = await prisma.campaign.findUnique({ where: { id: i.options.getString("campaign", true) } });
    if (!c) { await i.editReply({ embeds: [errorEmbed("Campaign not found.")] }); return; }
    await i.editReply({ embeds: [overlandEmbed(c.name, `${c.description}\n\nObjectives: ${c.objectives ?? "See description."}\nTasks: ${c.tasks ? JSON.stringify(c.tasks).slice(0, 800) : "See description."}\nReward: ${c.pointReward} points\nStarts: ${c.startsAt.toISOString().slice(0, 10)}\nEnds: ${c.endsAt.toISOString().slice(0, 10)}\nRequirements: ${c.submissionRequirements ?? "None listed."}`)] });
  } },
  { data: new SlashCommandBuilder().setName("submit").setDescription("Submit work to a campaign").addStringOption((o) => o.setName("campaign").setDescription("Campaign ID").setRequired(true)).addStringOption((o) => o.setName("content").setDescription("Describe your submission").setRequired(true)).addStringOption((o) => o.setName("category").setDescription("Type of contribution").addChoices({ name: "Community", value: "community" }, { name: "Social", value: "social" }, { name: "Creative", value: "creative" }, { name: "Research", value: "research" }, { name: "Education", value: "education" })).addStringOption((o) => o.setName("link").setDescription("Link to your work")).addStringOption((o) => o.setName("image_url").setDescription("HTTPS image URL supporting your submission")), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    const m = await ensureMember(i.user.id, i.user.username);
    try {
      const { duplicate, submission } = await submitWork(m.id, i.options.getString("campaign", true), { content: i.options.getString("content", true), category: (i.options.getString("category") ?? "social") as "community" | "social" | "creative" | "research" | "education", linkUrl: i.options.getString("link"), imageUrl: i.options.getString("image_url") });
      await i.editReply({ embeds: [overlandEmbed(duplicate ? "Submission already pending" : "Submission received", duplicate ? `You already have a pending submission (${submission.id}) for this campaign.` : `Submission ${submission.id} is pending staff review. You will be notified when it is reviewed.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Submission failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("campaign-review").setDescription("Staff: review a campaign submission").addStringOption((o) => o.setName("submission").setDescription("Submission ID").setRequired(true)).addBooleanOption((o) => o.setName("approve").setDescription("Approve this submission").setRequired(true)).addStringOption((o) => o.setName("feedback").setDescription("Feedback for the member")), execute: async (i) => {
    if (!(await requirePerm(i, "campaigns.review"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const result = await reviewSubmission(i.user.id, i.options.getString("submission", true), i.options.getBoolean("approve", true), i.options.getString("feedback") ?? undefined);
      await i.editReply({ embeds: [overlandEmbed("Review recorded", `Submission ${result.submission.id} is now ${result.submission.status}.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Review failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("rewards").setDescription("Browse the Overland rewards marketplace"), execute: async (i) => {
    await i.deferReply();
    const list = (await listRewards(true)).slice(0, 25);
    if (list.length === 0) {
      await i.editReply({ embeds: [overlandEmbed("Rewards marketplace", "No rewards are available right now. Check back later.")] });
      return;
    }
    const description = list.map((reward: { name: string; description: string; costOvercredits: number; stock: number | null; eligibility: string | null }, index: number) =>
      "**" + (index + 1) + ". " + reward.name + "** · " + reward.costOvercredits + " Overcredits" +
      (reward.stock !== null ? " · " + reward.stock + " available" : " · Unlimited stock") +
      "\n" + reward.description.slice(0, 220) +
      (reward.eligibility ? "\nEligibility: " + reward.eligibility : "")
    ).join("\n\n").slice(0, 3900);
    const rows: ActionRowBuilder<ButtonBuilder>[] = [];
    for (let offset = 0; offset < list.length; offset += 5) {
      rows.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        ...list.slice(offset, offset + 5).map((reward) =>
          new ButtonBuilder()
            .setCustomId("overland:reward:claim:" + reward.id)
            .setLabel(("Claim " + reward.name).slice(0, 80))
            .setStyle(ButtonStyle.Success)
        )
      ));
    }
    const embed = overlandEmbed("Overland rewards marketplace", description);
    if (list[0]?.imageUrl) embed.setThumbnail(list[0].imageUrl);
    await i.editReply({ embeds: [embed], components: rows });
  } },
  { data: new SlashCommandBuilder().setName("claim").setDescription("Claim a reward with Overcredits").addStringOption((o) => o.setName("reward").setDescription("Reward ID").setRequired(true)), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    const m = await ensureMember(i.user.id, i.user.username);
    try {
      const result = await claimReward(m.id, i.options.getString("reward", true));
      if (result.duplicate) {
        await i.editReply({ embeds: [overlandEmbed("Claim already pending", `You already have a pending claim for this reward (${result.claim.id}). Staff will review it.`)] });
        return;
      }
      await i.editReply({ embeds: [overlandEmbed("Reward claimed", `Claim ${result.claim.id} is pending staff approval. Your new Overcredits balance is ${result.balance?.overcredits ?? "unknown"}.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Claim failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("reward-claim").setDescription("Staff: approve, reject or fulfill a reward claim").addStringOption((o) => o.setName("claim").setDescription("Claim ID").setRequired(true)).addStringOption((o) => o.setName("action").setDescription("Action").setRequired(true).addChoices({ name: "Approve", value: "approve" }, { name: "Reject (refunds Overcredits)", value: "reject" }, { name: "Fulfill", value: "fulfill" })), execute: async (i) => {
    if (!(await requirePerm(i, "rewards.review"))) return;
    await i.deferReply({ ephemeral: true });
    const claimId = i.options.getString("claim", true);
    const action = i.options.getString("action", true);
    try {
      const updated = action === "approve" ? await approveClaim(i.user.id, claimId) : action === "reject" ? await rejectClaim(i.user.id, claimId) : await fulfillClaim(i.user.id, claimId);
      await i.editReply({ embeds: [overlandEmbed("Claim updated", `Claim ${updated.id} is now ${updated.status}.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Claim update failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("verify").setDescription("Start Discord verification"), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    try {
      const member = await ensureMember(i.user.id, i.user.username);
      const ageDays = (Date.now() - i.user.createdTimestamp) / 86400000;
      const result = await startVerification(member.id, ageDays, Boolean(i.user.avatar), i.guildId ?? undefined);
      if (!result.passed) {
        await i.editReply({ embeds: [errorEmbed(result.reasons.join("\n"))] });
        return;
      }
      if (!result.challenge) {
        await completeVerification(member.id, null, "", ageDays, Boolean(i.user.avatar), i.user.id, i.guild ?? undefined);
        await i.editReply({ embeds: [overlandEmbed("Verification complete", "You are now verified as a Citizen.")] });
        return;
      }
      await i.editReply({ embeds: [overlandEmbed("Verification challenge", result.challenge.question + "\n\nUse /verify-answer with challenge ID: " + result.challenge.id + " and your answer. This challenge expires in 10 minutes.")] });
    } catch (err) { await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Verification could not start.")] }); }
  } },
  { data: new SlashCommandBuilder().setName("verify-answer").setDescription("Submit your verification challenge answer").addStringOption((o) => o.setName("challenge_id").setDescription("Challenge ID from /verify").setRequired(true)).addStringOption((o) => o.setName("answer").setDescription("Your answer").setRequired(true)), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    try {
      const member = await ensureMember(i.user.id, i.user.username);
      const ageDays = (Date.now() - i.user.createdTimestamp) / 86400000;
      await completeVerification(member.id, i.options.getString("challenge_id", true), i.options.getString("answer", true), ageDays, Boolean(i.user.avatar), i.user.id, i.guild ?? undefined);
      await i.editReply({ embeds: [overlandEmbed("Verification complete", "You are now verified as a Citizen. Welcome to Overland.")] });
    } catch (err) { await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Verification failed.")] }); }
  } },
  { data: new SlashCommandBuilder().setName("verify-user").setDescription("Staff: verify a member and grant Citizen").addUserOption((o) => o.setName("member").setDescription("Member to verify").setRequired(true)), execute: async (i) => {
    if (!(await requirePerm(i, "roles.assign"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const target = i.options.getUser("member", true);
      await staffVerify(target.id, i.user.id, i.guild ?? undefined);
      await i.editReply({ embeds: [overlandEmbed("Member verified", `${target.username} is now a Citizen.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Verification failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("warn").setDescription("Staff: warn a member").addUserOption((o) => o.setName("member").setDescription("Member to warn").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)), execute: async (i) => {
    if (!(await requirePerm(i, "moderation.action"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const target = i.options.getUser("member", true);
      await warnMember(target.id, i.user.id, i.options.getString("reason", true), i.guild ?? undefined);
      await i.editReply({ embeds: [overlandEmbed("Warning recorded", `${target.username} has been warned.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Warn failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("timeout").setDescription("Staff: timeout a member").addUserOption((o) => o.setName("member").setDescription("Member to timeout").setRequired(true)).addIntegerOption((o) => o.setName("minutes").setDescription("Timeout length in minutes").setRequired(true).setMinValue(1).setMaxValue(40320)).addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)), execute: async (i) => {
    if (!(await requirePerm(i, "moderation.action"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const target = i.options.getUser("member", true);
      await timeoutMember(target.id, i.user.id, i.options.getInteger("minutes", true), i.options.getString("reason", true), i.guild ?? undefined);
      await i.editReply({ embeds: [overlandEmbed("Timeout recorded", `${target.username} has been timed out.`) ] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Timeout failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("grant-role").setDescription("Staff: award Pioneer or Luminary recognition").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)).addStringOption((o) => o.setName("role").setDescription("Recognition role").setRequired(true).addChoices({ name: "Pioneer", value: "Pioneer" }, { name: "Luminary", value: "Luminary" })).addStringOption((o) => o.setName("reason").setDescription("Reason")), execute: async (i) => {
    if (!(await requirePerm(i, "roles.assign"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const target = i.options.getUser("member", true);
      const m = await ensureMember(target.id, target.username);
      const roleName = i.options.getString("role", true);
      await staffAward(m.id, roleName, i.user.id, i.options.getString("reason") ?? undefined, i.guild ?? undefined);
      await i.editReply({ embeds: [overlandEmbed("Recognition awarded", roleName + " granted to " + target.username + ".")] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Role award failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("interests").setDescription("View self-assignable community interest roles"), execute: async (i) => {
    const roles = await listSelfAssignable();
    const text = roles.map((role) => "• **" + role.name + "**" + (role.description ? " - " + role.description : "")).join("\n");
    await i.reply({ ephemeral: true, embeds: [overlandEmbed("Community interests", text ? text + "\n\nUse /interest to add or remove an interest role." : "No interest roles are currently available.")] });
  } },
  { data: new SlashCommandBuilder().setName("interest").setDescription("Add or remove one of your interest roles").addStringOption((o) => o.setName("role").setDescription("Exact interest role name").setRequired(true)), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    try {
      const roleName = i.options.getString("role", true);
      const role = await prisma.role.findUnique({ where: { name: roleName } });
      if (!role || !role.isSelfAssignable || role.isInternal) {
        await i.editReply({ embeds: [errorEmbed("That role is not available for self-assignment. Use /interests to see available roles.")] });
        return;
      }
      const member = await ensureMember(i.user.id, i.user.username);
      const existing = await prisma.memberRole.findUnique({ where: { memberId_roleId: { memberId: member.id, roleId: role.id } } });
      if (existing) {
        await removeRole(member.id, role.name, i.user.id, "Member removed their interest role", i.guild ?? undefined);
        await i.editReply({ embeds: [overlandEmbed("Interest role removed", "You no longer have the " + role.name + " role.")] });
      } else {
        await assignRole(member.id, role.name, i.user.id, "Member self-assigned interest role", i.guild ?? undefined);
        await i.editReply({ embeds: [overlandEmbed("Interest role added", "You now have the " + role.name + " role.")] });
      }
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Could not update your interest role.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("role-history").setDescription("Staff: view a member's role history").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)), execute: async (i) => {
    if (!(await requirePerm(i, "audit.view"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const target = i.options.getUser("member", true);
      const member = await ensureMember(target.id, target.username);
      const history = await getRoleHistory(member.id, 15);
      const lines = history.map((entry) => {
        const when = entry.createdAt.toISOString().slice(0, 16).replace("T", " ");
        return when + " • " + entry.action + " • " + entry.role.name + (entry.reason ? " • " + entry.reason : "");
      });
      await i.editReply({ embeds: [overlandEmbed("Role history: " + target.username, lines.join("\n").slice(0, 3900) || "No role history found.")] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Could not load role history.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("comrade-verify").setDescription("Staff: verify an X follow and grant or revoke Comrade").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)).addBooleanOption((o) => o.setName("following").setDescription("Whether the official X follow is verified").setRequired(true)), execute: async (i) => {
    if (!(await requirePerm(i, "roles.assign"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const target = i.options.getUser("member", true);
      const member = await ensureMember(target.id, target.username);
      const following = i.options.getBoolean("following", true);
      await setXFollowVerified(member.id, i.user.id, following, i.guild ?? undefined);
      if (following) await grantComrade(member.id, i.user.id, i.guild ?? undefined);
      await i.editReply({ embeds: [overlandEmbed(following ? "Comrade verification complete" : "Comrade eligibility removed", following ? target.username + " has been verified as following Overland on X and granted Comrade." : target.username + " no longer meets the Comrade X-follow requirement.")] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Comrade verification failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("ticket").setDescription("Open a support ticket").addStringOption((o) => o.setName("category").setDescription("Category").setRequired(true).addChoices(...["General Inquiry", "Partnerships", "Business Development", "Opportunities", "Technical Support", "Other"].map((c) => ({ name: c, value: c })))).addStringOption((o) => o.setName("topic").setDescription("What do you need help with?").setRequired(true)), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    try {
      const { ticket, channelId } = await createTicketChannel(i.guild, i.user.id, i.options.getString("category", true), i.options.getString("topic", true));
      await i.editReply({ embeds: [overlandEmbed("Ticket opened", channelId ? `Ticket ${formatTicketNumber(ticket.number)} (${ticket.category}) is open in <#${channelId}>. Staff will respond there.` : `Ticket ${formatTicketNumber(ticket.number)} (${ticket.category}) is open. Staff will create the private channel shortly.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Ticket creation failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("ticket-claim").setDescription("Staff: claim a ticket").addStringOption((o) => o.setName("ticket").setDescription("Ticket ID").setRequired(true)), execute: async (i) => {
    if (!(await requirePerm(i, "tickets.manage"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const ticket = await claimTicket(i.options.getString("ticket", true), i.user.id);
      await i.editReply({ embeds: [overlandEmbed("Ticket claimed", `Ticket #${ticket.number} is now claimed by you.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Claim failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("ticket-close").setDescription("Close a ticket (run inside the ticket channel, or pass a ticket ID)").addStringOption((o) => o.setName("ticket").setDescription("Ticket ID, if not run inside the ticket channel")), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    try {
      let ticketId = i.options.getString("ticket");
      if (!ticketId) {
        const found = await findTicketByChannel(i.channelId ?? "");
        if (!found) { await i.editReply({ embeds: [errorEmbed("This is not a ticket channel. Pass the ticket ID.")] }); return; }
        ticketId = found.id;
      }
      if (!ticketId) { await i.editReply({ embeds: [errorEmbed("No ticket identified.")] }); return; }
      // Only staff with tickets.manage, or the member who opened the ticket, may close it.
      const ticketRow = await prisma.ticket.findUnique({ where: { id: ticketId }, include: { member: true } });
      const isOpener = ticketRow?.member.userId === i.user.id;
      if (!isOpener && !(await hasPermission(i.user.id, "tickets.manage"))) {
        await i.editReply({ embeds: [errorEmbed("Only staff or the member who opened this ticket can close it.")] });
        return;
      }
      const { ticket, transcript } = await closeTicket(ticketId, i.user.id, i.guild ?? undefined);
      await i.editReply({ embeds: [overlandEmbed("Ticket closed", `Ticket #${ticket.number} is closed. Transcript saved (${transcript.split("\n").length} messages).`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Close failed.")] });
    }
  } },
  { data: new SlashCommandBuilder().setName("x-announce").setDescription("Staff: manually announce an X post").addStringOption((o) => o.setName("url").setDescription("X post URL").setRequired(true)), execute: async (i) => {
    if (!(await requirePerm(i, "x.manage"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const { sent } = await announceManual(i.options.getString("url", true), i.user.id, i.client);
      await i.editReply({ embeds: [overlandEmbed("X announcement recorded", sent ? "Post announced to the configured channel." : "Post recorded. No announcement channel is configured, or the channel could not be reached.")] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Announcement failed.")] });
    }
  } },
];

// Referenced so tree-shaking and future balance tooling keep the import live.
void awardPoints;
