import crypto from "node:crypto";
import { getPool } from "../mysql.js";

const CURRENCIES = new Set(["OVERPOINTS", "OVERCREDITS"]);
const BALANCE_FIELDS = {
  overall: "overpoints",
  community: "community_points",
  social: "social_points",
  referrals: "referral_points",
  contributions: "contribution_points",
};

export async function listPointTransactions(guildId, { memberId, category } = {}) {
  const pool = getPool();
  const clauses = ["pt.guild_id = ?"];
  const values = [guildId];
  if (memberId) { clauses.push("(pt.member_id = ? OR u.discord_id = ?)"); values.push(memberId, memberId); }
  if (category) { clauses.push("pt.category = ?"); values.push(category); }
  const [transactions] = await pool.execute(
    "SELECT pt.id, pt.guild_id AS guildId, pt.member_id AS memberId, pt.currency, pt.category, pt.amount, pt.balance_after AS balanceAfter, pt.source, pt.idempotency_key AS idempotencyKey, pt.reason, pt.actor_id AS actorId, pt.created_at AS createdAt, u.username AS memberUsername, u.discord_id AS memberDiscordId FROM point_transactions pt INNER JOIN discord_members dm ON dm.id = pt.member_id INNER JOIN users u ON u.id = dm.user_id WHERE " + clauses.join(" AND ") + " ORDER BY pt.created_at DESC LIMIT 100",
    values,
  );
  const [configs] = await pool.execute(
    "SELECT config_key AS configKey, config_value AS configValue FROM bot_configuration WHERE guild_id = ? AND config_key IN ('pointValues','dailyLimits')",
    [guildId],
  );
  const settings = Object.fromEntries(configs.map((row) => [row.configKey, row.configValue]));
  const [guildRows] = await pool.execute("SELECT settings FROM guilds WHERE guild_id = ? LIMIT 1", [guildId]);
  let guildSettings = guildRows[0]?.settings || {};
  if (typeof guildSettings === "string") {
    try { guildSettings = JSON.parse(guildSettings); } catch { guildSettings = {}; }
  }
  return {
    transactions: transactions.map((row) => ({
      id: row.id, guildId: row.guildId, memberId: row.memberId, currency: row.currency,
      category: row.category, amount: row.amount, balanceAfter: row.balanceAfter, source: row.source,
      idempotencyKey: row.idempotencyKey, reason: row.reason, actorId: row.actorId, createdAt: row.createdAt,
      member: { user: { username: row.memberUsername, discordId: row.memberDiscordId } },
    })),
    pointValues: settings.pointValues || guildSettings.pointValues || {},
    dailyLimits: settings.dailyLimits || guildSettings.dailyLimits || {},
  };
}

export async function adjustMemberBalance(guildId, memberRef, currency, amount, reason, actorId) {
  if (!CURRENCIES.has(currency)) throw Object.assign(new Error("Invalid currency"), { status: 400 });
  if (!Number.isSafeInteger(amount) || amount === 0 || Math.abs(amount) > 1000000000) {
    throw Object.assign(new Error("Amount must be a non-zero safe integer within the allowed limit"), { status: 400 });
  }
  const pool = getPool(), connection = await pool.getConnection();
  const field = currency === "OVERPOINTS" ? "overpoints" : "overcredits";
  try {
    await connection.beginTransaction();
    const [members] = await connection.execute(
      "SELECT dm.id FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id WHERE dm.guild_id = ? AND (dm.id = ? OR u.discord_id = ?) LIMIT 1 FOR UPDATE",
      [guildId, memberRef, memberRef],
    );
    if (!members.length) throw Object.assign(new Error("Member not found (use Discord ID or member ID)"), { status: 404 });
    const memberId = members[0].id;
    await connection.execute(
      "INSERT IGNORE INTO point_balances (member_id, guild_id, overpoints, overcredits) VALUES (?, ?, 0, 0)",
      [memberId, guildId],
    );
    const [balances] = await connection.execute("SELECT overpoints, overcredits, community_points AS communityPoints, social_points AS socialPoints, referral_points AS referralPoints, contribution_points AS contributionPoints FROM point_balances WHERE member_id = ? FOR UPDATE", [memberId]);
    const before = Number(balances[0][field]);
    const after = before + amount;
    if (!Number.isSafeInteger(after) || after < 0) throw Object.assign(new Error("Adjustment would make the balance negative or exceed safe limits"), { status: 400 });
    await connection.execute("UPDATE point_balances SET " + field + " = ? WHERE member_id = ?", [after, memberId]);
    const id = crypto.randomUUID();
    await connection.execute(
      "INSERT INTO point_transactions (id, guild_id, member_id, currency, category, amount, balance_after, source, idempotency_key, reason, actor_id) VALUES (?, ?, ?, ?, 'admin', ?, ?, 'ADMIN_ADJUSTMENT', ?, ?, ?)",
      [id, guildId, memberId, currency, amount, after, "admin-adjustment:" + id, reason || "Admin adjustment", actorId],
    );
    const [updated] = await connection.execute("SELECT overpoints, overcredits, community_points AS communityPoints, social_points AS socialPoints, referral_points AS referralPoints, contribution_points AS contributionPoints FROM point_balances WHERE member_id = ?", [memberId]);
    await connection.execute(
      "INSERT INTO audit_logs (id, guild_id, actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, 'economy.adjust', 'PointBalance', ?, ?)",
      [crypto.randomUUID(), guildId, actorId, memberId, JSON.stringify({ currency, amount, reason: reason || null })],
    );
    await connection.commit();
    return { memberId, ...updated[0] };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function getLeaderboard(guildId, category = "overall", period = "LIFETIME") {
  const pool = getPool();
  const field = BALANCE_FIELDS[category] || "overpoints";
  if (period === "LIFETIME") {
    const [rows] = await pool.execute(
      "SELECT u.username, u.discord_id AS discordId, pb." + field + " AS score FROM point_balances pb INNER JOIN discord_members dm ON dm.id = pb.member_id INNER JOIN users u ON u.id = dm.user_id WHERE pb.guild_id = ? ORDER BY pb." + field + " DESC LIMIT 20",
      [guildId],
    );
    return rows.map((row, index) => ({ rank: index + 1, username: row.username, discordId: row.discordId, score: row.score }));
  }
  const days = period === "WEEKLY" ? 7 : 30;
  const categoryFilter = category === "overall" ? "" : " AND pt.category = ?";
  const values = category === "overall" ? [guildId, days] : [guildId, category, days];
  const [rows] = await pool.execute(
    "SELECT u.username, u.discord_id AS discordId, SUM(pt.amount) AS score FROM point_transactions pt INNER JOIN discord_members dm ON dm.id = pt.member_id INNER JOIN users u ON u.id = dm.user_id WHERE pt.guild_id = ? AND pt.amount > 0" + categoryFilter + " AND pt.created_at >= DATE_SUB(UTC_TIMESTAMP(3), INTERVAL ? DAY) GROUP BY pt.member_id, u.username, u.discord_id ORDER BY score DESC LIMIT 20",
    values,
  );
  return rows.map((row, index) => ({ rank: index + 1, username: row.username, discordId: row.discordId, score: row.score }));
}
