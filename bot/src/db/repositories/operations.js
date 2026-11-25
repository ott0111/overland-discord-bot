import crypto from "node:crypto";
import { getPool } from "../mysql.js";

function parseJson(value, fallback = {}) {
  if (value == null) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

async function ensureGuild(connection, guildId) {
  await connection.execute(
    "INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())",
    [guildId],
  );
}

export async function listConfiguration(guildId) {
  const [rows] = await getPool().execute(
    "SELECT id, config_key AS key, config_value AS value, updated_by AS updatedBy, updated_at AS updatedAt FROM bot_configuration WHERE guild_id = ? ORDER BY config_key ASC",
    [guildId],
  );
  return rows.map((row) => ({ ...row, value: parseJson(row.value) }));
}

export async function getConfiguration(guildId, key, fallback = {}) {
  const [rows] = await getPool().execute(
    "SELECT config_value FROM bot_configuration WHERE guild_id = ? AND config_key = ? LIMIT 1",
    [guildId, key],
  );
  return rows.length ? parseJson(rows[0].config_value, fallback) : fallback;
}

export async function setConfiguration(guildId, key, value, actorId) {
  const normalizedKey = String(key || "").trim().slice(0, 120);
  if (!normalizedKey) throw Object.assign(new Error("Configuration key is required"), { status: 400 });
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await ensureGuild(connection, guildId);
    await connection.execute(
      "INSERT INTO bot_configuration (id, guild_id, config_key, config_value, updated_by) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)",
      [crypto.randomUUID(), guildId, normalizedKey, JSON.stringify(value ?? null), actorId || null],
    );
    await connection.execute(
      "INSERT INTO audit_logs (id, guild_id, actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, 'config.update', 'BotConfiguration', ?, ?)",
      [crypto.randomUUID(), guildId, actorId || null, normalizedKey, JSON.stringify({ key: normalizedKey })],
    );
    await connection.commit();
    return { key: normalizedKey, value: value ?? null, updatedBy: actorId || null };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function appendAuditLog(guildId, input) {
  const id = crypto.randomUUID();
  await getPool().execute(
    "INSERT INTO audit_logs (id, guild_id, actor_id, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))",
    [id, guildId, input.actorId || null, String(input.action || "operation").slice(0, 120), input.entityType ? String(input.entityType).slice(0, 120) : null, input.entityId ? String(input.entityId).slice(0, 190) : null, JSON.stringify(input.details && typeof input.details === "object" ? input.details : {})],
  );
  return { id, createdAt: new Date().toISOString() };
}

export async function listAuditLogs(guildId, take = 100) {
  const [rows] = await getPool().execute(
    "SELECT id, actor_id AS actorId, action, entity_type AS entityType, entity_id AS entityId, details, created_at AS createdAt FROM audit_logs WHERE guild_id = ? ORDER BY created_at DESC LIMIT ?",
    [guildId, Math.min(200, Math.max(1, Number(take) || 100))],
  );
  return rows.map((row) => ({ ...row, details: parseJson(row.details), createdAt: new Date(row.createdAt).toISOString() }));
}

export async function getXDashboard(guildId) {
  const config = await getConfiguration(guildId, "xIntegration", {});
  const [rows] = await getPool().execute(
    "SELECT id, post_id AS postId, author_username AS authorUsername, post_text AS text, url, media_urls AS mediaUrls, is_reply AS isReply, is_repost AS isRepost, announced_at AS announcedAt, announced_channel_id AS announcedChannelId, created_at AS createdAt FROM x_posts WHERE guild_id = ? ORDER BY created_at DESC LIMIT 30",
    [guildId],
  );
  return { config, posts: rows.map((row) => ({ ...row, mediaUrls: parseJson(row.mediaUrls, []), isReply: Boolean(row.isReply), isRepost: Boolean(row.isRepost) })) };
}

export async function createManualXAnnouncement(guildId, input, actorId) {
  const text = String(input.text || "").trim();
  const url = String(input.url || "").trim();
  if (!text || text.length > 5000) throw Object.assign(new Error("Announcement text must be between 1 and 5,000 characters"), { status: 400 });
  let parsed;
  try { parsed = new URL(url); } catch { throw Object.assign(new Error("A valid announcement URL is required"), { status: 400 }); }
  if (!["https:", "http:"].includes(parsed.protocol)) throw Object.assign(new Error("Announcement URL must use HTTP or HTTPS"), { status: 400 });
  const config = await getConfiguration(guildId, "xIntegration", {});
  const id = crypto.randomUUID();
  const postId = "manual-" + id;
  const channelId = /^\d{17,20}$/.test(String(config.announcementChannelId || "")) ? String(config.announcementChannelId) : null;
  await getPool().execute(
    "INSERT INTO x_posts (id, guild_id, post_id, author_username, post_text, url, media_urls, is_reply, is_repost, announced_channel_id) VALUES (?, ?, ?, ?, ?, ?, JSON_ARRAY(), FALSE, FALSE, ?)",
    [id, guildId, postId, String(config.username || "OverlandFinance").replace(/^@/, "").slice(0, 100), text, parsed.toString(), channelId],
  );
  await appendAuditLog(guildId, { actorId, action: "x.manual_announce", entityType: "XPost", entityId: id, details: { url: parsed.toString() } });
  return { id, postId, text, url: parsed.toString(), announcedChannelId: channelId, published: false };
}

export async function getNormalizedOverview(guildId) {
  const pool = getPool();
  const [[memberRows], [ticketRows], [claimRows], [submissionRows], [todayPoints], [todayCheckins], [todayJoins], [categoryRows], [dailyPoints], [dailyCheckins], [dailyJoins]] = await Promise.all([
    pool.execute("SELECT COUNT(*) AS total FROM discord_members WHERE guild_id = ?", [guildId]),
    pool.execute("SELECT COUNT(*) AS total FROM tickets WHERE guild_id = ? AND status IN ('OPEN','CLAIMED')", [guildId]),
    pool.execute("SELECT COUNT(*) AS total FROM reward_claims WHERE guild_id = ? AND status = 'PENDING'", [guildId]),
    pool.execute("SELECT COUNT(*) AS total FROM campaign_submissions WHERE guild_id = ? AND status = 'PENDING'", [guildId]),
    pool.execute("SELECT COALESCE(SUM(amount),0) AS total FROM point_transactions WHERE guild_id = ? AND currency = 'OVERPOINTS' AND amount > 0 AND created_at >= CURRENT_DATE()", [guildId]),
    pool.execute("SELECT COUNT(*) AS total FROM daily_checkins WHERE guild_id = ? AND checkin_date = CURRENT_DATE()", [guildId]),
    pool.execute("SELECT COUNT(*) AS total FROM discord_members WHERE guild_id = ? AND joined_at >= CURRENT_DATE()", [guildId]),
    pool.execute("SELECT category, SUM(amount) AS total FROM point_transactions WHERE guild_id = ? AND currency = 'OVERPOINTS' AND amount > 0 GROUP BY category ORDER BY total DESC", [guildId]),
    pool.execute("SELECT DATE(created_at) AS day, SUM(amount) AS total FROM point_transactions WHERE guild_id = ? AND currency = 'OVERPOINTS' AND amount > 0 AND created_at >= CURRENT_DATE() - INTERVAL 13 DAY GROUP BY DATE(created_at)", [guildId]),
    pool.execute("SELECT checkin_date AS day, COUNT(*) AS total FROM daily_checkins WHERE guild_id = ? AND checkin_date >= CURRENT_DATE() - INTERVAL 13 DAY GROUP BY checkin_date", [guildId]),
    pool.execute("SELECT DATE(joined_at) AS day, COUNT(*) AS total FROM discord_members WHERE guild_id = ? AND joined_at >= CURRENT_DATE() - INTERVAL 13 DAY GROUP BY DATE(joined_at)", [guildId]),
  ]);
  const points = new Map(dailyPoints.map((row) => [new Date(row.day).toISOString().slice(0, 10), Number(row.total)]));
  const checkins = new Map(dailyCheckins.map((row) => [new Date(row.day).toISOString().slice(0, 10), Number(row.total)]));
  const joins = new Map(dailyJoins.map((row) => [new Date(row.day).toISOString().slice(0, 10), Number(row.total)]));
  const daily = [];
  for (let offset = 13; offset >= 0; offset--) {
    const date = new Date();
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    const key = date.toISOString().slice(0, 10);
    daily.push({ date: key, points: points.get(key) || 0, checkins: checkins.get(key) || 0, joins: joins.get(key) || 0 });
  }
  return {
    members: Number(memberRows[0]?.total || 0),
    openTickets: Number(ticketRows[0]?.total || 0),
    pendingClaims: Number(claimRows[0]?.total || 0),
    pendingSubmissions: Number(submissionRows[0]?.total || 0),
    pointsToday: Number(todayPoints[0]?.total || 0),
    checkinsToday: Number(todayCheckins[0]?.total || 0),
    joinsToday: Number(todayJoins[0]?.total || 0),
    pointsByCategory: categoryRows.map((row) => ({ category: row.category, total: Number(row.total || 0) })),
    daily,
    db: "ok",
  };
}

export async function markXPostAnnounced(guildId, id, channelId) {
  await getPool().execute(
    "UPDATE x_posts SET announced_at = CURRENT_TIMESTAMP(3), announced_channel_id = ? WHERE guild_id = ? AND id = ?",
    [channelId, guildId, id],
  );
}

export async function getLatestXPostId(guildId) {
  const [rows] = await getPool().execute(
    "SELECT post_id AS postId FROM x_posts WHERE guild_id = ? AND post_id NOT LIKE 'manual-%' ORDER BY created_at DESC LIMIT 1",
    [guildId],
  );
  return rows[0]?.postId || null;
}

export async function insertXPost(guildId, post) {
  const [result] = await getPool().execute(
    "INSERT IGNORE INTO x_posts (id, guild_id, post_id, author_username, post_text, url, media_urls, is_reply, is_repost, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [crypto.randomUUID(), guildId, String(post.id), String(post.username || "unknown").replace(/^@/, "").slice(0, 100), String(post.text || "").slice(0, 10000), String(post.url), JSON.stringify(Array.isArray(post.mediaUrls) ? post.mediaUrls : []), Boolean(post.isReply), Boolean(post.isRepost), post.createdAt ? new Date(post.createdAt) : new Date()],
  );
  return result.affectedRows === 1;
}
