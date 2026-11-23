import crypto from "node:crypto";
import { getPool } from "../mysql.js";

async function resolveTarget(connection, guildId, target) {
  const discordId = String(target.id);
  const username = String(target.username || target.globalName || target.tag || discordId).slice(0, 100);
  await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
  await connection.execute("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)", ["discord:" + discordId, discordId, username]);
  const [users] = await connection.execute("SELECT id FROM users WHERE discord_id = ? LIMIT 1", [discordId]);
  await connection.execute("INSERT INTO discord_members (id, guild_id, user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)", ["member:" + guildId + ":" + discordId, guildId, users[0].id]);
  const [members] = await connection.execute("SELECT id FROM discord_members WHERE guild_id = ? AND user_id = ? LIMIT 1", [guildId, users[0].id]);
  return members[0].id;
}

export async function createModerationAction(guildId, input) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
    await connection.execute("SELECT guild_id FROM guilds WHERE guild_id = ? FOR UPDATE", [guildId]);
    const targetMemberId = await resolveTarget(connection, guildId, input.target);
    const [cases] = await connection.execute("SELECT COALESCE(MAX(case_number), 0) + 1 AS nextCase FROM moderation_actions WHERE guild_id = ?", [guildId]);
    const caseId = Number(cases[0].nextCase || 1);
    const id = crypto.randomUUID();
    const duration = input.durationMinutes == null ? null : Number(input.durationMinutes);
    if (duration !== null && (!Number.isSafeInteger(duration) || duration < 1 || duration > 40320)) throw Object.assign(new Error("Invalid moderation duration"), { status: 400 });
    await connection.execute("INSERT INTO moderation_actions (id, guild_id, target_member_id, actor_id, case_number, action_type, reason, duration_minutes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))", [id, guildId, targetMemberId, String(input.actorId), caseId, String(input.action).toUpperCase().slice(0, 40), String(input.reason || "No reason provided").slice(0, 4000), duration]);
    await connection.commit();
    return { id, caseId, action: String(input.action).toUpperCase(), targetId: String(input.target.id), target: input.target.tag || input.target.username || String(input.target.id), moderatorId: String(input.actorId), reason: String(input.reason || "No reason provided"), at: new Date().toISOString(), duration: input.duration || null };
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function listModerationActions(guildId, limit = 100) {
  const [rows] = await getPool().execute("SELECT ma.id, ma.case_number AS caseId, ma.action_type AS action, ma.reason, ma.duration_minutes AS durationMinutes, ma.actor_id AS moderatorId, ma.created_at AS at, tu.discord_id AS targetId, tu.username AS target, au.username AS moderator FROM moderation_actions ma INNER JOIN discord_members tdm ON tdm.id = ma.target_member_id INNER JOIN users tu ON tu.id = tdm.user_id LEFT JOIN users au ON au.discord_id = ma.actor_id WHERE ma.guild_id = ? ORDER BY ma.created_at DESC LIMIT ?", [guildId, Math.min(200, Math.max(1, Number(limit) || 100))]);
  return rows.map((row) => ({ ...row, caseId: Number(row.caseId), duration: row.durationMinutes ? row.durationMinutes + " minutes" : null }));
}
