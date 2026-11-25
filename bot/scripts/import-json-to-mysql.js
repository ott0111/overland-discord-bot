import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import { getPool, closePool } from "../src/db/mysql.js";
import { runMigrations } from "../src/db/migrate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_FILE = path.join(ROOT, "data", "overland.json");
const apply = process.argv.includes("--apply");

function stableId(prefix, value) {
  return prefix + "_" + crypto.createHash("sha256").update(String(value)).digest("hex").slice(0, 40);
}

function asDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function importGuild(pool, guildId, guildData) {
  await pool.execute(
    "INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, ?, ?)",
    [guildId, JSON.stringify(guildData.settings || {}), JSON.stringify(guildData.stats || {})],
  );

  const settings = guildData.settings && typeof guildData.settings === "object" ? guildData.settings : {};
  const configEntries = [
    ["pointValues", settings.pointValues],
    ["dailyLimits", settings.dailyLimits],
    ["verification", settings.verification],
    ["security", settings.security],
    ["infoContent", settings.info],
    ["xIntegration", settings.x ? {
      enabled: Boolean(settings.x.enabled),
      username: settings.x.username || null,
      announcementChannelId: settings.x.channelId || null,
      ignoreReplies: settings.x.ignoreReplies !== false,
      ignoreReposts: settings.x.ignoreReposts !== false,
      pollMinutes: Number(settings.x.pollMinutes || 15),
    } : null],
    ["welcomeConfig", {
      welcomeChannelId: settings.welcomeChannelId || null,
      leaveChannelId: settings.leaveChannelId || null,
      eventLogChannelId: settings.eventLogChannelId || null,
      welcomeMessage: settings.welcomeMessage || "Welcome {user} to {server}!",
      welcomeEnabled: Boolean(settings.welcomeEnabled),
      welcomeDm: Boolean(settings.welcomeDm),
    }],
  ];
  for (const [key, value] of configEntries) {
    if (value === null || value === undefined) continue;
    await pool.execute(
      "INSERT IGNORE INTO bot_configuration (id, guild_id, config_key, config_value, updated_by) VALUES (?, ?, ?, ?, NULL)",
      [stableId("config", guildId + ":" + key), guildId, key, JSON.stringify(value)],
    );
  }

  const memberIds = new Map();
  const members = guildData.members && typeof guildData.members === "object" ? Object.entries(guildData.members) : [];
  for (const [mapId, member] of members) {
    const discordId = String(member?.id || mapId);
    if (!/^\\d{17,20}$/.test(discordId)) continue;
    const userId = stableId("usr", discordId);
    await pool.execute(
      "INSERT IGNORE INTO users (id, discord_id, username) VALUES (?, ?, ?)",
      [userId, discordId, String(member.username || discordId).slice(0, 100)],
    );
    const [users] = await pool.execute("SELECT id FROM users WHERE discord_id = ? LIMIT 1", [discordId]);
    const actualUserId = users[0]?.id || userId;
    const memberId = stableId("mbr", guildId + ":" + discordId);
    await pool.execute(
      "INSERT IGNORE INTO discord_members (id, guild_id, user_id, joined_at, verified_at, x_follow_verified, x_follow_verified_at, is_suspicious, profile) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        memberId, guildId, actualUserId, asDate(member.joinedAt), asDate(member.verifiedAt),
        Boolean(member.xFollowVerified), asDate(member.xFollowVerifiedAt), Boolean(member.suspicious),
        JSON.stringify({
          streak: Number(member.streak || 0),
          lastCheckin: member.lastCheckin || null,
          rulesAcceptedAt: member.rulesAcceptedAt || null,
          achievements: Array.isArray(member.achievements) ? member.achievements : [],
        }),
      ],
    );
    const [storedMembers] = await pool.execute("SELECT id FROM discord_members WHERE guild_id = ? AND user_id = ? LIMIT 1", [guildId, actualUserId]);
    const actualMemberId = storedMembers[0]?.id || memberId;
    memberIds.set(discordId, actualMemberId);

    await pool.execute(
      "INSERT IGNORE INTO point_balances (member_id, guild_id, overpoints, overcredits, community_points, social_points, referral_points, contribution_points) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [
        actualMemberId, guildId, Number(member.overpoints || 0), Number(member.overcredits || 0),
        Number(member.communityPoints || 0), Number(member.socialPoints || 0),
        Number(member.referralPoints || 0), Number(member.contributionPoints || 0),
      ],
    );
  }

  const roleIds = new Map();
  const ensureRole = async (roleName) => {
    const name = String(roleName || "").trim().slice(0, 100);
    if (!name) return null;
    if (roleIds.has(name)) return roleIds.get(name);
    const roleId = stableId("role", guildId + ":" + name);
    await pool.execute(
      "INSERT IGNORE INTO roles (id, guild_id, name, is_internal) VALUES (?, ?, ?, ?)",
      [roleId, guildId, name, ["Founder", "Admin", "Warden"].includes(name)],
    );
    roleIds.set(name, roleId);
    return roleId;
  };

  const roleDefaults = [
    ["Founder", null, {}],
    ["Admin", null, {}],
    ["Warden", null, {}],
    ["Pioneer", null, {}],
    ["Luminary", null, {}],
    ["Creator", null, { progression: { kind: "approved_submission_count", categories: ["social_post", "infographic", "video", "graphic_design", "community_initiative"], minimum: 3 } }],
    ["Intellect", null, { progression: { kind: "approved_submission_count", categories: ["educational_thread", "article", "industry_research", "contribution_article"], minimum: 3 } }],
    ["Socialite", 500, { progression: { kind: "minimum_overpoints", minimum: 500 } }],
    ["Comrade", null, { requireVerified: true, requireXFollow: true }],
    ["Citizen", null, { requireVerified: true }],
  ];
  for (let index = 0; index < roleDefaults.length; index++) {
    const [name, minimum, config] = roleDefaults[index];
    const roleId = await ensureRole(name);
    const configuredDiscordRoleId = String(guildData.settings?.roleIds?.[name] || (name === "Citizen" ? guildData.settings?.verifiedRoleId : "") || "");
    if (/^\d{17,20}$/.test(configuredDiscordRoleId)) {
      await pool.execute(
        "UPDATE roles SET discord_role_id = COALESCE(discord_role_id, ?) WHERE guild_id = ? AND id = ?",
        [configuredDiscordRoleId, guildId, roleId],
      );
    }
    await pool.execute(
      "UPDATE roles SET min_overpoints = COALESCE(min_overpoints, ?), config = CASE WHEN config IS NULL OR JSON_LENGTH(config) = 0 THEN CAST(? AS JSON) ELSE config END WHERE guild_id = ? AND id = ?",
      [minimum, JSON.stringify(config), guildId, roleId],
    );
  }
  const citizenRoleId = roleIds.get("Citizen");
  const comradeRoleId = roleIds.get("Comrade");
  if (citizenRoleId && comradeRoleId) {
    await pool.execute(
      "UPDATE roles SET requires_role_id = COALESCE(requires_role_id, ?) WHERE guild_id = ? AND id = ?",
      [citizenRoleId, guildId, comradeRoleId],
    );
  }

  for (const [discordId, member] of members) {
    const memberId = memberIds.get(String(member?.id || discordId));
    if (!memberId) continue;
    for (const roleName of Array.isArray(member.roles) ? member.roles : []) {
      const roleId = await ensureRole(roleName);
      if (!roleId) continue;
      await pool.execute(
        "INSERT IGNORE INTO member_roles (id, guild_id, member_id, role_id, granted_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))",
        [stableId("mr", guildId + ":" + discordId + ":" + roleName), guildId, memberId, roleId],
      );
    }
  }

  for (const history of Array.isArray(guildData.roleHistory) ? guildData.roleHistory : []) {
    const discordId = String(history.memberId || "");
    const memberId = memberIds.get(discordId);
    const roleId = await ensureRole(history.role);
    if (!memberId || !roleId) continue;
    const action = String(history.action || "GRANTED").toUpperCase() === "REVOKED" ? "REVOKED" : "GRANTED";
    const historyId = stableId("role-history", guildId + ":" + (history.id || JSON.stringify(history)));
    await pool.execute(
      "INSERT IGNORE INTO role_history (id, guild_id, member_id, role_id, action, actor_id, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [historyId, guildId, memberId, roleId, action, history.actorId ? String(history.actorId) : null, history.reason ? String(history.reason).slice(0, 1000) : null, asDate(history.at || history.createdAt) || new Date()],
    );
  }

  const campaignIds = new Map();
  for (const campaign of Array.isArray(guildData.campaigns) ? guildData.campaigns : []) {
    const legacyId = String(campaign.id || "");
    const campaignId = stableId("campaign", guildId + ":" + (legacyId || campaign.name || JSON.stringify(campaign)));
    const statusValue = String(campaign.status || "DRAFT").toUpperCase();
    const status = statusValue === "COMPLETED" ? "ENDED" : ["DRAFT", "ACTIVE", "ENDED", "CANCELLED"].includes(statusValue) ? statusValue : "DRAFT";
    const startsAt = asDate(campaign.startsAt || campaign.createdAt) || new Date();
    const endsAt = asDate(campaign.endsAt) || startsAt;
    await pool.execute(
      "INSERT IGNORE INTO campaigns (id, guild_id, name, description, objectives, starts_at, ends_at, tasks, point_reward, submission_requirements, status, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [campaignId, guildId, String(campaign.name || "Imported campaign").slice(0, 190), String(campaign.description || ""), campaign.objectives ? String(campaign.objectives) : null, startsAt, endsAt, JSON.stringify(Array.isArray(campaign.tasks) ? campaign.tasks : []), Math.max(0, Number(campaign.pointReward || 0)), campaign.submissionRequirements ? String(campaign.submissionRequirements) : null, status, campaign.createdBy ? String(campaign.createdBy) : null, asDate(campaign.createdAt) || startsAt],
    );
    if (legacyId) campaignIds.set(legacyId, campaignId);
  }
  for (const submission of Array.isArray(guildData.submissions) ? guildData.submissions : []) {
    const discordId = String(submission.memberId || "");
    const memberId = memberIds.get(discordId);
    const campaignId = campaignIds.get(String(submission.campaignId || ""));
    if (!memberId || !campaignId) continue;
    const statusValue = String(submission.status || "PENDING").toUpperCase();
    const status = ["PENDING", "APPROVED", "REJECTED"].includes(statusValue) ? statusValue : "PENDING";
    const submissionId = stableId("submission", guildId + ":" + (submission.id || JSON.stringify(submission)));
    await pool.execute(
      "INSERT IGNORE INTO campaign_submissions (id, guild_id, campaign_id, member_id, content, category, link_url, image_url, status, feedback, points_awarded, reviewed_by, reviewed_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [submissionId, guildId, campaignId, memberId, String(submission.content || ""), String(submission.category || "social").slice(0, 80), submission.linkUrl ? String(submission.linkUrl) : null, submission.imageUrl ? String(submission.imageUrl) : null, status, submission.feedback ? String(submission.feedback) : null, Math.max(0, Number(submission.pointsAwarded || 0)), submission.reviewedBy ? String(submission.reviewedBy) : null, asDate(submission.reviewedAt), asDate(submission.createdAt) || new Date()],
    );
  }

  for (const action of Array.isArray(guildData.moderation) ? guildData.moderation : []) {
    const targetId = memberIds.get(String(action.targetId || action.memberId || ""));
    if (!targetId) continue;
    const durationMatch = String(action.duration || action.reason || "").match(/(\d+)\s+minutes?/i);
    const durationMinutes = durationMatch ? Number(durationMatch[1]) : null;
    const actionId = stableId("moderation", guildId + ":" + (action.id || JSON.stringify(action)));
    await pool.execute(
      "INSERT IGNORE INTO moderation_actions (id, guild_id, target_member_id, actor_id, case_number, action_type, reason, duration_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [actionId, guildId, targetId, String(action.moderatorId || action.actorId || "SYSTEM").slice(0, 20), Math.max(0, Number(action.caseId || 0)), String(action.action || action.type || "WARN").toUpperCase().slice(0, 40), String(action.reason || "No reason provided").slice(0, 4000), durationMinutes, asDate(action.at || action.createdAt) || new Date()],
    );
  }

  for (const referral of Array.isArray(guildData.referrals) ? guildData.referrals : []) {
    const referrerId = memberIds.get(String(referral.referrerId || referral.referrerMemberId || ""));
    const referredId = memberIds.get(String(referral.referredId || referral.referredMemberId || ""));
    if (!referrerId || !referredId || referrerId === referredId) continue;
    const referralId = stableId("referral", guildId + ":" + (referral.id || referrerId + ":" + referredId));
    await pool.execute(
      "INSERT IGNORE INTO referrals (id, guild_id, referrer_member_id, referred_member_id, invite_code, verified, verified_at, retained_7d, became_comrade, suspicious, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [referralId, guildId, referrerId, referredId, String(referral.inviteCode || "legacy").slice(0, 100), Boolean(referral.verified), asDate(referral.verifiedAt), Boolean(referral.retained7d || referral.retained_7d), Boolean(referral.becameComrade || referral.became_comrade), Boolean(referral.suspicious), asDate(referral.createdAt) || new Date()],
    );
  }

  for (const [code, invite] of Object.entries(guildData.invites || {})) {
    const memberId = memberIds.get(String(invite.memberId || ""));
    if (!memberId || !code) continue;
    await pool.execute(
      "INSERT IGNORE INTO referral_invites (id, guild_id, member_id, invite_code, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?)",
      [stableId("referral-invite", guildId + ":" + code), guildId, memberId, String(code).slice(0, 100), asDate(invite.createdAt) || new Date(), asDate(invite.revokedAt)],
    );
    const [members] = await pool.execute("SELECT u.discord_id FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id WHERE dm.id = ? LIMIT 1", [memberId]);
    await pool.execute(
      "INSERT IGNORE INTO invite_tracking (id, guild_id, invite_code, inviter_id, uses, payload, updated_at) VALUES (?, ?, ?, ?, ?, JSON_OBJECT(), CURRENT_TIMESTAMP(3))",
      [stableId("invite-tracking", guildId + ":" + code), guildId, String(code).slice(0, 100), members[0]?.discord_id || null, Math.max(0, Number(invite.uses || 0))],
    );
  }

  const achievementDefaults = [
    ["first-checkin", "First Steps", "Complete your first daily check-in", "CHECKIN", 1, 0, 0],
    ["streak-7", "Consistent", "Reach a 7 day check-in streak", "STREAK", 7, 0, 0],
    ["points-1000", "Contributor", "Earn 1,000 Overpoints", "POINTS", 1000, 0, 0],
    ["referral-5", "Connector", "Refer 5 verified members", "REFERRAL", 5, 0, 0],
    ["creator", "Creator", "Get approved for 3 creative submissions", "CREATOR", 3, 0, 0],
    ["first-verification", "First Verification", "Complete Discord verification", "VERIFICATION", 1, 10, 0],
    ["first-contribution", "First Contribution", "Get a contribution approved", "CONTRIBUTION", 1, 20, 5],
    ["first-referral", "First Referral", "Bring in a verified referral", "REFERRAL", 1, 15, 5],
    ["first-social", "First Social Submission", "Get a social submission approved", "SOCIAL", 1, 15, 5],
    ["streak-30", "Thirty Day Streak", "Check in 30 days in a row", "STREAK", 30, 100, 25],
  ];
  const achievementIds = new Map();
  const ensureAchievement = async (key, name, description, kind = "CUSTOM", threshold = 1, overpointsReward = 0, overcreditsReward = 0) => {
    const safeKey = String(key || "").toLowerCase().slice(0, 100);
    if (!safeKey) return null;
    if (achievementIds.has(safeKey)) return achievementIds.get(safeKey);
    const id = stableId("achievement", guildId + ":" + safeKey);
    await pool.execute(
      "INSERT IGNORE INTO achievements (id, guild_id, achievement_key, name, description, kind, threshold, overpoints_reward, overcredits_reward, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)",
      [id, guildId, safeKey, String(name || safeKey).slice(0, 190), String(description || "").slice(0, 2000), String(kind || "CUSTOM").slice(0, 40), Math.max(1, Number(threshold) || 1), Math.max(0, Number(overpointsReward) || 0), Math.max(0, Number(overcreditsReward) || 0)],
    );
    const [rows] = await pool.execute("SELECT id FROM achievements WHERE guild_id = ? AND achievement_key = ? LIMIT 1", [guildId, safeKey]);
    const actualId = rows[0]?.id || id;
    achievementIds.set(safeKey, actualId);
    return actualId;
  };
  for (const [key, name, description, kind, threshold, overpointsReward, overcreditsReward] of achievementDefaults) {
    await ensureAchievement(key, name, description, kind, threshold, overpointsReward, overcreditsReward);
  }
  for (const item of Array.isArray(guildData.achievements) ? guildData.achievements : []) {
    const key = String(item.key || item.id || "").slice(0, 100);
    const memberId = memberIds.get(String(item.memberId || ""));
    if (!key || !memberId) continue;
    const achievementId = await ensureAchievement(key, item.name || key, item.description || "Imported Overland achievement");
    await pool.execute(
      "INSERT IGNORE INTO member_achievements (id, guild_id, member_id, achievement_id, awarded_at) VALUES (?, ?, ?, ?, ?)",
      [stableId("member-achievement", guildId + ":" + memberId + ":" + key), guildId, memberId, achievementId, asDate(item.at || item.awardedAt) || new Date()],
    );
  }
  for (const [discordId, member] of members) {
    const memberId = memberIds.get(String(member?.id || discordId));
    if (!memberId) continue;
    for (const keyValue of Array.isArray(member.achievements) ? member.achievements : []) {
      const key = String(keyValue).slice(0, 100);
      const achievementId = await ensureAchievement(key, key.replace(/-/g, " "), "Imported member achievement");
      if (!achievementId) continue;
      await pool.execute(
        "INSERT IGNORE INTO member_achievements (id, guild_id, member_id, achievement_id, awarded_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))",
        [stableId("member-achievement", guildId + ":" + memberId + ":" + key), guildId, memberId, achievementId],
      );
    }
  }

  for (const tx of Array.isArray(guildData.transactions) ? guildData.transactions : []) {
    const discordId = String(tx.memberId || "");
    const memberId = memberIds.get(discordId);
    if (!memberId) continue;
    const id = stableId("txn", guildId + ":" + (tx.id || tx.idempotencyKey || JSON.stringify(tx)));
    const key = String(tx.idempotencyKey || tx.id || id).slice(0, 190);
    await pool.execute(
      "INSERT IGNORE INTO point_transactions (id, guild_id, member_id, currency, category, amount, balance_after, source, idempotency_key, reason, actor_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        id, guildId, memberId, tx.currency === "OVERCREDITS" ? "OVERCREDITS" : "OVERPOINTS",
        String(tx.category || "community").slice(0, 80), Number(tx.amount || 0),
        Number(tx.balanceAfter || 0), String(tx.source || "ADMIN_ADJUSTMENT").slice(0, 80),
        key, tx.reason ? String(tx.reason) : null, tx.actorId ? String(tx.actorId) : null,
        asDate(tx.at || tx.createdAt) || new Date(),
      ],
    );
  }

  const groupIds = {
    Owner: "pg_owner",
    Executive: "pg_executive",
    Administration: "pg_administration",
    Moderation: "pg_moderation",
    Development: "pg_development",
    Support: "pg_support",
    Rewards_Management: "pg_rewards_management",
    "Rewards Management": "pg_rewards_management",
  };
  for (const staff of Array.isArray(guildData.team) ? guildData.team : []) {
    const discordId = String(staff.discordId || "");
    if (!/^\\d{17,20}$/.test(discordId)) continue;
    const groupName = String(staff.group || staff.groupName || "Support");
    const groupId = groupIds[groupName] || groupIds.Support;
    const userId = stableId("usr", discordId);
    await pool.execute(
      "INSERT IGNORE INTO users (id, discord_id, username) VALUES (?, ?, ?)",
      [userId, discordId, String(staff.username || discordId).slice(0, 100)],
    );
    const [users] = await pool.execute("SELECT id FROM users WHERE discord_id = ? LIMIT 1", [discordId]);
    const actualUserId = users[0]?.id || userId;
    const memberId = stableId("mbr", guildId + ":" + discordId);
    await pool.execute(
      "INSERT IGNORE INTO discord_members (id, guild_id, user_id, profile) VALUES (?, ?, ?, ?)",
      [memberId, guildId, actualUserId, JSON.stringify({ legacyStaff: true })],
    );
    const [storedMembers] = await pool.execute("SELECT id FROM discord_members WHERE guild_id = ? AND user_id = ? LIMIT 1", [guildId, actualUserId]);
    const actualMemberId = storedMembers[0]?.id || memberId;
    const status = ["ACTIVE", "INACTIVE", "SUSPENDED", "REMOVED"].includes(staff.status) ? staff.status : "ACTIVE";
    await pool.execute(
      "INSERT IGNORE INTO internal_team_members (id, guild_id, member_id, discord_id, username, public_role, job_title, department, responsibilities, group_id, status, added_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [
        stableId("staff", guildId + ":" + discordId), guildId, actualMemberId, discordId,
        String(staff.username || discordId).slice(0, 100),
        String(staff.publicRole || staff.jobTitle || groupName).slice(0, 100),
        String(staff.jobTitle || groupName).slice(0, 120),
        String(staff.department || "Unassigned").slice(0, 100),
        staff.responsibilities ? String(staff.responsibilities) : null,
        groupId, status, asDate(staff.addedAt) || new Date(),
      ],
    );
    for (const permission of Array.isArray(staff.permissions) ? staff.permissions : []) {
      const key = String(permission).slice(0, 120);
      if (!key) continue;
      await pool.execute(
        "INSERT IGNORE INTO permissions (id, group_id, permission_key) VALUES (?, ?, ?)",
        [stableId("perm", groupName + ":" + key), groupId, key],
      );
    }
  }
  for (const reward of Array.isArray(guildData.rewards) ? guildData.rewards : []) {
    const rewardId = String(reward.id || stableId("reward", guildId + ":" + JSON.stringify(reward))).slice(0,64);
    await pool.execute(
      "INSERT IGNORE INTO rewards (id,guild_id,name,description,image_url,cost_overcredits,stock,eligibility,active,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [rewardId,guildId,String(reward.name || "Untitled reward").slice(0,190),String(reward.description || ""),reward.imageUrl || null,Math.max(0,Number(reward.costOvercredits || 0)),reward.stock === undefined ? null : reward.stock,String(reward.eligibility || "") || null,reward.active !== false,asDate(reward.createdAt) || new Date()],
    );
  }
  for (const claim of Array.isArray(guildData.claims) ? guildData.claims : []) {
    const memberId = memberIds.get(String(claim.memberId || ""));
    const rewardId = String(claim.rewardId || "").slice(0,64);
    if (!memberId || !rewardId) continue;
    const status = ["PENDING","APPROVED","REJECTED","FULFILLED","CANCELLED"].includes(String(claim.status || "").toUpperCase()) ? String(claim.status).toUpperCase() : "PENDING";
    const claimId = String(claim.id || stableId("claim", guildId + ":" + JSON.stringify(claim))).slice(0,64);
    await pool.execute(
      "INSERT IGNORE INTO reward_claims (id,guild_id,reward_id,member_id,status,cost_overcredits,idempotency_key,reviewed_by,created_at) VALUES (?,?,?,?,?,?,?,?,?)",
      [claimId,guildId,rewardId,memberId,status,Math.max(0,Number(claim.costOvercredits || 0)),"legacy-claim:"+claimId,claim.reviewedBy || null,asDate(claim.createdAt) || new Date()],
    );
  }
  for (const ticket of Array.isArray(guildData.tickets) ? guildData.tickets : []) {
    const memberId = memberIds.get(String(ticket.ownerId || ""));
    if (!memberId) continue;
    const status = ["OPEN","CLAIMED","CLOSED","ARCHIVED"].includes(String(ticket.status || "").toUpperCase()) ? String(ticket.status).toUpperCase() : "OPEN";
    const ticketId = String(ticket.id || stableId("ticket", guildId + ":" + String(ticket.channelId || ""))).slice(0,64);
    await pool.execute(
      "INSERT IGNORE INTO tickets (id,guild_id,category,channel_id,member_id,status,claimed_by,rating,closed_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
      [ticketId,guildId,String(ticket.category || "support").slice(0,100),ticket.channelId || null,memberId,status,ticket.claimedBy || null,Number.isInteger(ticket.rating)?ticket.rating:null,asDate(ticket.closedAt),asDate(ticket.createdAt) || new Date()],
    );
  }

  for (const post of Array.isArray(guildData.xPosts) ? guildData.xPosts : []) {
    const postId = String(post.postId || post.id || "").slice(0, 40);
    if (!postId) continue;
    const id = stableId("xpost", guildId + ":" + postId);
    await pool.execute(
      "INSERT IGNORE INTO x_posts (id, guild_id, post_id, author_username, post_text, url, media_urls, is_reply, is_repost, announced_at, announced_channel_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      [id, guildId, postId, String(post.authorUsername || "OverlandFinance").slice(0, 100), String(post.text || "").slice(0, 10000), String(post.url || "https://x.com"), JSON.stringify(Array.isArray(post.mediaUrls) ? post.mediaUrls : []), Boolean(post.isReply), Boolean(post.isRepost), asDate(post.announcedAt), post.announcedChannelId || null, asDate(post.createdAt) || new Date()],
    );
  }

  for (const entry of Array.isArray(guildData.audit) ? guildData.audit : []) {
    const id = stableId("audit", guildId + ":" + (entry.id || JSON.stringify(entry)));
    await pool.execute(
      "INSERT IGNORE INTO audit_logs (id, guild_id, actor_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [id, guildId, entry.actorId || entry.discordId || null, String(entry.action || "legacy.operation").slice(0, 120), String(entry.entityType || entry.resource || "Legacy").slice(0, 120), entry.entityId ? String(entry.entityId).slice(0, 190) : null, JSON.stringify(entry.details && typeof entry.details === "object" ? entry.details : {}), asDate(entry.createdAt || entry.at) || new Date()],
    );
  }

  const communityCollections = [
    ["suggestions", "SUGGESTION"],
    ["reports", "REPORT"],
    ["appeals", "APPEAL"],
    ["vouches", "VOUCH"],
    ["blacklist", "BLACKLIST"],
    ["tempRoles", "TEMP_ROLE"],
    ["reminders", "REMINDER"],
  ];
  for (const [collection, recordType] of communityCollections) {
    for (const record of Array.isArray(guildData[collection]) ? guildData[collection] : []) {
      const id = stableId("community", guildId + ":" + recordType + ":" + (record.id || JSON.stringify(record)));
      await pool.execute(
        "INSERT IGNORE INTO community_records (id, guild_id, record_type, status, subject_id, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        [id, guildId, recordType, record.status ? String(record.status).slice(0, 40) : null, record.userId || record.memberId || record.targetId || null, record.actorId || record.createdBy || null, JSON.stringify(record), asDate(record.createdAt || record.at || record.expiresAt) || new Date()],
      );
    }
  }

}

async function main() {
  const raw = await fs.readFile(DATA_FILE, "utf8");
  const database = JSON.parse(raw);
  if (!database || typeof database.guilds !== "object" || Array.isArray(database.guilds)) {
    throw new Error("The JSON file does not contain a valid guilds object.");
  }

  const entries = Object.entries(database.guilds);
  console.log("[Import] Mode: " + (apply ? "APPLY" : "DRY RUN"));
  console.log("[Import] Source: " + DATA_FILE);
  console.log("[Import] Guild records found: " + entries.length);

  const pool = getPool();
  if (apply) await runMigrations();
  const [tables] = await pool.execute(
    "SELECT TABLE_NAME FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    ["guild_state"],
  );
  if (!tables.length) {
    console.log("[Import] Destination tables do not exist. Dry-run made no changes; rerun with --apply to create the schema and import.");
    return;
  }

  let existing = 0;
  let memberCount = 0;
  let transactionCount = 0;
  let staffCount = 0;
  for (const [guildId, guildData] of entries) {
    const [rows] = await pool.execute("SELECT guild_id FROM guild_state WHERE guild_id = ?", [guildId]);
    if (rows.length) existing++;
    memberCount += Object.keys(guildData.members || {}).length;
    transactionCount += Array.isArray(guildData.transactions) ? guildData.transactions.length : 0;
    staffCount += Array.isArray(guildData.team) ? guildData.team.length : 0;
  }
  console.log("[Import] Existing compatibility guild records: " + existing);
  console.log("[Import] New compatibility records eligible: " + (entries.length - existing));
  console.log("[Import] Normalized candidates: " + memberCount + " members, " + transactionCount + " transactions, " + staffCount + " staff records, " + (entries.reduce((n, [,g]) => n + (Array.isArray(g.rewards)?g.rewards.length:0),0)) + " rewards, " + (entries.reduce((n, [,g]) => n + (Array.isArray(g.claims)?g.claims.length:0),0)) + " reward claims, " + (entries.reduce((n, [,g]) => n + (Array.isArray(g.tickets)?g.tickets.length:0),0)) + " tickets.");
  if (!apply) {
    console.log("[Import] Nothing was written. Review the counts, then rerun with --apply.");
    return;
  }

  let inserted = 0;
  let skipped = 0;
  for (const [guildId, guildData] of entries) {
    const [result] = await pool.execute(
      "INSERT IGNORE INTO guild_state (guild_id, data, revision) VALUES (?, ?, 1)",
      [guildId, JSON.stringify(guildData)],
    );
    if (result.affectedRows === 1) inserted++;
    else skipped++;
    await importGuild(pool, guildId, guildData);
  }
  console.log("[Import] Compatibility rows inserted: " + inserted + "; existing rows skipped: " + skipped + ".");
  console.log("[Import] Normalized identity, balances, roles, achievements, campaigns, submissions, transactions, staff, rewards, reward claims, and tickets imported idempotently.");
  console.log("[Import] Historical X posts, audit events and community records were also imported where source data was present.");
  console.log("[Import] The original JSON file was not changed or deleted.");
}

main().catch((error) => {
  console.error("[Import] Failed:", error.message);
  process.exitCode = 1;
}).finally(async () => {
  await closePool().catch(() => {});
});
