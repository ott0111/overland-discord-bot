import crypto from "node:crypto";
import { getPool } from "../mysql.js";

const KINDS = new Set(["VERIFICATION", "CONTRIBUTION", "REFERRAL", "SOCIAL", "MILESTONE", "EVENT", "STREAK", "CHECKIN", "POINTS", "CREATOR", "CUSTOM"]);
const CONTRIBUTION_CATEGORIES = ["graphic_design", "industry_research", "contribution_article", "product_feedback", "community_initiative", "significant_contribution"];
const SOCIAL_CATEGORIES = ["social_post", "infographic", "educational_thread", "article", "campaign_contribution", "video"];
const CREATIVE_CATEGORIES = ["social_post", "infographic", "video", "graphic_design"];

function memberIdentity(user) {
  const discordId = String(typeof user === "string" ? user : user.id);
  const username = String(typeof user === "string" ? discordId : user.username || user.globalName || discordId).slice(0, 100);
  return { discordId, username, userId: "discord:" + discordId, memberId: "member:" + "guild" + ":" + discordId };
}

async function resolveMember(connection, guildId, user) {
  const identity = memberIdentity(user);
  await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
  await connection.execute(
    "INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)",
    [identity.userId, identity.discordId, identity.username],
  );
  const [users] = await connection.execute("SELECT id FROM users WHERE discord_id = ? LIMIT 1", [identity.discordId]);
  await connection.execute(
    "INSERT IGNORE INTO discord_members (id, guild_id, user_id) VALUES (?, ?, ?)",
    ["member:" + guildId + ":" + identity.discordId, guildId, users[0].id],
  );
  const [members] = await connection.execute(
    "SELECT dm.id, dm.verified_at AS verifiedAt FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id WHERE dm.guild_id = ? AND u.discord_id = ? LIMIT 1",
    [guildId, identity.discordId],
  );
  if (!members.length) throw new Error("Unable to resolve guild member.");
  await connection.execute("INSERT IGNORE INTO point_balances (member_id, guild_id) VALUES (?, ?)", [members[0].id, guildId]);
  return { ...members[0], discordId: identity.discordId };
}

export async function listAchievements(guildId) {
  const [rows] = await getPool().execute(
    "SELECT a.id, a.achievement_key AS key, a.name, a.description, a.kind, a.threshold, a.overpoints_reward AS overpointsReward, a.overcredits_reward AS overcreditsReward, a.active, (SELECT COUNT(*) FROM member_achievements ma WHERE ma.achievement_id = a.id) AS memberCount FROM achievements a WHERE a.guild_id = ? ORDER BY a.name ASC",
    [guildId],
  );
  return rows.map((row) => ({
    ...row,
    threshold: Number(row.threshold),
    overpointsReward: Number(row.overpointsReward),
    overcreditsReward: Number(row.overcreditsReward),
    active: Boolean(row.active),
    _count: { members: Number(row.memberCount || 0) },
  }));
}

export async function createAchievement(guildId, input) {
  const key = String(input.key || input.name || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 100);
  const name = String(input.name || "").trim().slice(0, 190);
  const description = String(input.description || "").trim().slice(0, 2000);
  const kind = String(input.kind || "CUSTOM").toUpperCase();
  const threshold = input.threshold ?? 1;
  const overpointsReward = input.overpointsReward ?? 0;
  const overcreditsReward = input.overcreditsReward ?? 0;
  if (!key || !name || !description) throw Object.assign(new Error("key, name, and description are required"), { status: 400 });
  if (!KINDS.has(kind)) throw Object.assign(new Error("Unsupported achievement kind"), { status: 400 });
  if (!Number.isSafeInteger(threshold) || threshold < 1 || !Number.isSafeInteger(overpointsReward) || overpointsReward < 0 || !Number.isSafeInteger(overcreditsReward) || overcreditsReward < 0) {
    throw Object.assign(new Error("Threshold must be positive and rewards must be non-negative whole numbers"), { status: 400 });
  }
  const id = crypto.randomUUID();
  try {
    await getPool().execute(
      "INSERT INTO achievements (id, guild_id, achievement_key, name, description, kind, threshold, overpoints_reward, overcredits_reward, active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, TRUE)",
      [id, guildId, key, name, description, kind, threshold, overpointsReward, overcreditsReward],
    );
  } catch (error) {
    if (error.code === "ER_DUP_ENTRY") throw Object.assign(new Error("An achievement with that key already exists"), { status: 409 });
    throw error;
  }
  const [rows] = await getPool().execute(
    "SELECT id, achievement_key AS key, name, description, kind, threshold, overpoints_reward AS overpointsReward, overcredits_reward AS overcreditsReward, active FROM achievements WHERE id = ? LIMIT 1",
    [id],
  );
  return { ...rows[0], active: Boolean(rows[0].active), _count: { members: 0 } };
}

async function conditionMet(connection, guildId, member, achievement, balances) {
  const kind = String(achievement.kind || "CUSTOM").toUpperCase();
  const threshold = Number(achievement.threshold || 1);
  if (kind === "VERIFICATION") return Boolean(member.verifiedAt);
  if (kind === "POINTS" || kind === "MILESTONE" || kind === "CUSTOM") return Number(balances.overpoints || 0) >= threshold;
  if (kind === "CHECKIN") {
    const [rows] = await connection.execute("SELECT COUNT(*) AS total FROM daily_checkins WHERE guild_id = ? AND member_id = ?", [guildId, member.id]);
    return Number(rows[0]?.total || 0) >= threshold;
  }
  if (kind === "STREAK") {
    const [rows] = await connection.execute("SELECT COALESCE(MAX(streak), 0) AS maxStreak FROM daily_checkins WHERE guild_id = ? AND member_id = ?", [guildId, member.id]);
    return Number(rows[0]?.maxStreak || 0) >= threshold;
  }
  if (kind === "REFERRAL") {
    const [rows] = await connection.execute("SELECT COUNT(*) AS total FROM referrals WHERE guild_id = ? AND referrer_member_id = ? AND verified = TRUE AND suspicious = FALSE", [guildId, member.id]);
    return Number(rows[0]?.total || 0) >= threshold;
  }
  if (["CONTRIBUTION", "SOCIAL", "CREATOR"].includes(kind)) {
    const categories = kind === "CONTRIBUTION" ? CONTRIBUTION_CATEGORIES : kind === "SOCIAL" ? SOCIAL_CATEGORIES : CREATIVE_CATEGORIES;
    const placeholders = categories.map(() => "?").join(",");
    const [rows] = await connection.execute(
      "SELECT COUNT(*) AS total FROM campaign_submissions WHERE guild_id = ? AND member_id = ? AND status = 'APPROVED' AND category IN (" + placeholders + ")",
      [guildId, member.id, ...categories],
    );
    return Number(rows[0]?.total || 0) >= threshold;
  }
  return false;
}

async function awardAchievementRewards(connection, guildId, memberId, achievement) {
  for (const [currency, amount] of [["OVERPOINTS", Number(achievement.overpointsReward || 0)], ["OVERCREDITS", Number(achievement.overcreditsReward || 0)]]) {
    if (!amount) continue;
    const field = currency === "OVERPOINTS" ? "overpoints" : "overcredits";
    await connection.execute("UPDATE point_balances SET " + field + " = " + field + " + ?, " + (currency === "OVERPOINTS" ? "community_points = community_points + ?, " : "") + "updated_at = CURRENT_TIMESTAMP(3) WHERE member_id = ?",
      currency === "OVERPOINTS" ? [amount, amount, memberId] : [amount, memberId]);
    const [balances] = await connection.execute("SELECT overpoints, overcredits FROM point_balances WHERE member_id = ? LIMIT 1", [memberId]);
    const key = "achievement:" + achievement.achievement_key + ":" + memberId + ":" + currency;
    await connection.execute(
      "INSERT IGNORE INTO point_transactions (id, guild_id, member_id, currency, category, amount, balance_after, source, idempotency_key, reason, actor_id) VALUES (?, ?, ?, ?, 'achievement', ?, ?, 'ACHIEVEMENT', ?, ?, 'SYSTEM')",
      [crypto.randomUUID(), guildId, memberId, currency, amount, Number(balances[0][field]), key, "Achievement unlocked: " + achievement.name],
    );
  }
}

export async function checkMemberAchievements(guildId, user) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const member = await resolveMember(connection, guildId, user);
    const [balanceRows] = await connection.execute("SELECT overpoints, overcredits FROM point_balances WHERE member_id = ? FOR UPDATE", [member.id]);
    const balances = balanceRows[0] || { overpoints: 0, overcredits: 0 };
    const [definitions] = await connection.execute("SELECT id, achievement_key, name, description, kind, threshold, overpoints_reward AS overpointsReward, overcredits_reward AS overcreditsReward FROM achievements WHERE guild_id = ? AND active = TRUE ORDER BY name ASC", [guildId]);
    const earned = [];
    for (const achievement of definitions) {
      const [existing] = await connection.execute("SELECT id FROM member_achievements WHERE member_id = ? AND achievement_id = ? LIMIT 1", [member.id, achievement.id]);
      if (existing.length) continue;
      if (!await conditionMet(connection, guildId, member, achievement, balances)) continue;
      const [inserted] = await connection.execute(
        "INSERT IGNORE INTO member_achievements (id, guild_id, member_id, achievement_id, awarded_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3))",
        [crypto.randomUUID(), guildId, member.id, achievement.id],
      );
      if (!inserted.affectedRows) continue;
      await awardAchievementRewards(connection, guildId, member.id, achievement);
      earned.push(achievement.name);
    }
    await connection.commit();
    return earned;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
