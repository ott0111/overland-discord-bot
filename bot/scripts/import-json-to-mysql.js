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
  console.log("[Import] Normalized identity, balances, roles, transactions, staff, rewards, reward claims, and tickets imported idempotently.");
  console.log("[Import] The original JSON file was not changed or deleted.");
}

main().catch((error) => {
  console.error("[Import] Failed:", error.message);
  process.exitCode = 1;
}).finally(async () => {
  await closePool().catch(() => {});
});
