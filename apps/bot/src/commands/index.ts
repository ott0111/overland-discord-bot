import { SlashCommandBuilder, type ChatInputCommandInteraction, type SlashCommandOptionsOnlyBuilder } from "discord.js";
import { prisma } from "../lib/db.js";
import { overlandEmbed, errorEmbed } from "../lib/embeds.js";
import { getBalance, awardPoints, computeDailyStreak } from "../lib/points.js";
import { getInfoContent } from "../lib/config.js";
import { awardDailyCheckin } from "../modules/economy/service.js";
import { hasPermission } from "../lib/permissions.js";
import { listActive, submitWork, reviewSubmission } from "../modules/campaigns/service.js";
import { checkAndGrant, listMemberAchievements } from "../modules/achievements/service.js";
import { listRewards, claimReward, approveClaim, rejectClaim, fulfillClaim } from "../modules/rewards/service.js";
import { createTicketChannel, claimTicket, closeTicket, findTicketByChannel, formatTicketNumber } from "../modules/tickets/service.js";
import { getLeaderboard } from "../modules/leaderboards/service.js";
import { announceManual } from "../modules/x-integration/service.js";
import { getReferralStats } from "../modules/referrals/service.js";
import { staffVerify } from "../modules/verification/service.js";
import { warnMember, timeoutMember } from "../modules/moderation/service.js";
import { assignRole } from "../modules/roles/service.js";

export interface Command { data: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder; execute: (i: ChatInputCommandInteraction) => Promise<void>; }

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
      const e = overlandEmbed(`${target.username} profile`, `Joined the community and verified through Overland Core.`)
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
      await prisma.dailyCheckin.create({ data: { memberId: m.id, date: today, streak } });
      await awardDailyCheckin(m.id, streak);
      const newlyGranted = await checkAndGrant(m.id).catch(() => [] as string[]);
      await i.editReply({ embeds: [overlandEmbed("Daily check-in complete", `Streak: ${streak} day${streak === 1 ? "" : "s"}. You earned 5 Overpoints${streak % 7 === 0 ? " plus a 10 Overcredit streak bonus" : ""}.${newlyGranted.length ? ` Achievement unlocked: ${newlyGranted.join(", ")}.` : ""}`)] });
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

export const commands: Command[] = [
  profileCmd(), dailyCmd(), leaderboardCmd(),
  simpleCmd("about", "About Overland Finance", (i) => replyInfo(i, "about", "About Overland Finance")),
  simpleCmd("links", "Official Overland links", (i) => replyInfo(i, "links", "Official links")),
  simpleCmd("team", "Meet the Overland team", (i) => replyInfo(i, "team", "Team")),
  simpleCmd("roadmap", "Overland roadmap", (i) => replyInfo(i, "roadmap", "Roadmap")),
  simpleCmd("updates", "Latest Overland updates", (i) => replyInfo(i, "updates", "Updates")),
  simpleCmd("faq", "Frequently asked questions", (i) => replyInfo(i, "faq", "FAQ")),
  simpleCmd("opportunities", "Open opportunities", (i) => replyInfo(i, "opportunities", "Opportunities")),
  simpleCmd("socials", "Overland social accounts", (i) => replyInfo(i, "socials", "Socials")),
  { data: new SlashCommandBuilder().setName("help").setDescription("List Overland Core commands"), execute: async (i) => { await i.reply({ ephemeral: true, embeds: [overlandEmbed("Overland Core commands", commands.map((c: Command) => `/${c.data.name} - ${c.data.description}`).join("\n"))] }); } },
  { data: new SlashCommandBuilder().setName("invite").setDescription("Get your personal referral invite link"), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    await ensureMember(i.user.id, i.user.username);
    const guild = i.guild;
    if (!guild) { await i.editReply("Use this in the server."); return; }
    const invite = await guild.invites.create(i.channelId ?? guild.systemChannelId ?? guild.id, { maxAge: 0, maxUses: 0, unique: true, reason: `Referral invite for ${i.user.username}` }).catch(() => null);
    await i.editReply({ embeds: [overlandEmbed("Your referral invite", invite ? `Share this link: https://discord.gg/${invite.code}\nNew members who join and verify earn you referral points.` : "Invite creation failed. Ask staff to check bot permissions.")] });
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
    await i.editReply({ embeds: [overlandEmbed(c.name, `${c.description}\n\nObjectives: ${c.objectives ?? "See description."}\nReward: ${c.pointReward} points\nEnds: ${c.endsAt.toISOString().slice(0, 10)}\nRequirements: ${c.submissionRequirements ?? "None listed."}`)] });
  } },
  { data: new SlashCommandBuilder().setName("submit").setDescription("Submit work to a campaign").addStringOption((o) => o.setName("campaign").setDescription("Campaign ID").setRequired(true)).addStringOption((o) => o.setName("content").setDescription("Describe your submission").setRequired(true)).addStringOption((o) => o.setName("link").setDescription("Link to your work")), execute: async (i) => {
    await i.deferReply({ ephemeral: true });
    const m = await ensureMember(i.user.id, i.user.username);
    try {
      const { duplicate, submission } = await submitWork(m.id, i.options.getString("campaign", true), { content: i.options.getString("content", true), linkUrl: i.options.getString("link") });
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
  { data: new SlashCommandBuilder().setName("rewards").setDescription("Browse the rewards marketplace"), execute: async (i) => {
    await i.deferReply();
    const list = await listRewards(true);
    await i.editReply({ embeds: [overlandEmbed("Rewards marketplace", list.map((r: { name: string; costOvercredits: number; stock: number | null; id: string }) => `${r.name} - ${r.costOvercredits} Overcredits${r.stock !== null ? ` (stock: ${r.stock})` : ""} (id: ${r.id})`).join("\n") || "No rewards available right now.")] });
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
  { data: new SlashCommandBuilder().setName("verify").setDescription("Start Discord verification"), execute: async (i) => { await i.reply({ ephemeral: true, embeds: [overlandEmbed("Verification", "Click the verification button in the onboarding channel. Staff review may be required for suspicious accounts.")] }); } },
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
  { data: new SlashCommandBuilder().setName("grant-role").setDescription("Staff: grant a community role to a member").addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)).addStringOption((o) => o.setName("role").setDescription("Role name, for example Pioneer").setRequired(true)).addStringOption((o) => o.setName("reason").setDescription("Reason")), execute: async (i) => {
    if (!(await requirePerm(i, "roles.assign"))) return;
    await i.deferReply({ ephemeral: true });
    try {
      const target = i.options.getUser("member", true);
      const m = await ensureMember(target.id, target.username);
      await assignRole(m.id, i.options.getString("role", true), i.user.id, i.options.getString("reason") ?? undefined, i.guild ?? undefined);
      await i.editReply({ embeds: [overlandEmbed("Role granted", `${i.options.getString("role", true)} granted to ${target.username}.`)] });
    } catch (err) {
      await i.editReply({ embeds: [errorEmbed(err instanceof Error ? err.message : "Role grant failed.")] });
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
