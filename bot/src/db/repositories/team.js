import crypto from "node:crypto";
import { getPool } from "../mysql.js";

const GROUPS = new Set(["Owner", "Executive", "Administration", "Moderation", "Development", "Support", "Rewards_Management"]);
const STATUSES = new Set(["ACTIVE", "INACTIVE", "SUSPENDED", "REMOVED"]);
const SELECT_TEAM = "SELECT t.id, t.member_id AS memberId, t.discord_id AS discordId, t.username, t.public_role AS publicRole, t.job_title AS jobTitle, t.department, t.responsibilities, t.group_id AS groupId, t.status, t.added_at AS addedAt, t.updated_at AS updatedAt, pg.name AS groupName, dm.user_id AS userId, GROUP_CONCAT(DISTINCT p.permission_key ORDER BY p.permission_key SEPARATOR ',') AS permissionList FROM internal_team_members t INNER JOIN permission_groups pg ON pg.id = t.group_id INNER JOIN discord_members dm ON dm.id = t.member_id LEFT JOIN permissions p ON p.group_id = pg.id";

function normalizeRows(rows) {
  return rows.map((row) => ({
    id: row.id, memberId: row.memberId, discordId: row.discordId, username: row.username,
    publicRole: row.publicRole, jobTitle: row.jobTitle, department: row.department,
    responsibilities: row.responsibilities, groupId: row.groupId, status: row.status,
    addedAt: row.addedAt, updatedAt: row.updatedAt,
    group: { id: row.groupId, name: row.groupName, permissions: row.permissionList ? row.permissionList.split(",") : [] },
    member: { id: row.memberId, user: { id: row.userId, discordId: row.discordId, username: row.username } },
  }));
}

export async function listTeam(guildId) {
  const [rows] = await getPool().execute(SELECT_TEAM + " WHERE t.guild_id = ? GROUP BY t.id ORDER BY t.added_at ASC", [guildId]);
  return normalizeRows(rows);
}

export async function addTeamMember(guildId, input) {
  const groupName = String(input.groupName || "");
  if (!GROUPS.has(groupName)) throw Object.assign(new Error("Unknown permission group"), { status: 400 });
  const pool = getPool();
  const connection = await pool.getConnection();
  const discordId = String(input.discordId);
  const username = String(input.username).trim();
  const userId = "discord:" + discordId;
  let memberId;
  const teamId = crypto.randomUUID();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
    await connection.execute("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)", [userId, discordId, username]);
    const [users] = await connection.execute("SELECT id FROM users WHERE discord_id = ?", [discordId]);
    const actualUserId = users[0].id;
    const proposedMemberId = "member:" + guildId + ":" + discordId;
    await connection.execute("INSERT INTO discord_members (id, guild_id, user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)", [proposedMemberId, guildId, actualUserId]);
    const [members] = await connection.execute("SELECT id FROM discord_members WHERE guild_id = ? AND user_id = ?", [guildId, actualUserId]);
    memberId = members[0].id;
    const [groups] = await connection.execute("SELECT id FROM permission_groups WHERE name = ?", [groupName]);
    if (!groups.length) throw Object.assign(new Error("Permission group has not been seeded"), { status: 400 });
    await connection.execute("INSERT INTO internal_team_members (id, guild_id, member_id, discord_id, username, public_role, job_title, department, responsibilities, group_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", [
      teamId, guildId, memberId, discordId, username, String(input.publicRole || input.jobTitle).trim(),
      String(input.jobTitle).trim(), String(input.department).trim(), input.responsibilities?.trim() || null, groups[0].id,
    ]);
    await connection.commit();
    const [rows] = await pool.execute(SELECT_TEAM + " WHERE t.guild_id = ? AND t.id = ? GROUP BY t.id", [guildId, teamId]);
    return normalizeRows(rows)[0];
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") throw Object.assign(new Error("Team member already exists"), { status: 409 });
    throw error;
  } finally { connection.release(); }
}

async function lockedTeamRecord(connection, guildId, id) {
  const [rows] = await connection.execute("SELECT t.id, t.group_id AS groupId, t.status, pg.name AS groupName FROM internal_team_members t INNER JOIN permission_groups pg ON pg.id = t.group_id WHERE t.guild_id = ? AND t.id = ? FOR UPDATE", [guildId, id]);
  return rows[0] || null;
}

export async function updateTeamMember(guildId, id, input, actorIsOwner) {
  const pool = getPool(), connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
    await connection.query("SELECT guild_id FROM guilds WHERE guild_id = ? FOR UPDATE", [guildId]);
    const existing = await lockedTeamRecord(connection, guildId, id);
    if (!existing) throw Object.assign(new Error("Team member not found"), { status: 404 });
    if (existing.groupName === "Owner" && !actorIsOwner) throw Object.assign(new Error("Only an Owner can modify another Owner"), { status: 403 });
    let targetGroupId = input.groupId;
    if (targetGroupId !== undefined) {
      const [groups] = await connection.execute("SELECT id, name FROM permission_groups WHERE id = ?", [targetGroupId]);
      if (!groups.length) throw Object.assign(new Error("Permission group not found"), { status: 400 });
      if (groups[0].name === "Owner" && !actorIsOwner) throw Object.assign(new Error("Only an existing Owner can appoint another Owner"), { status: 403 });
    }
    const leavingOwner = existing.groupName === "Owner" && ((targetGroupId !== undefined && targetGroupId !== existing.groupId) || (input.status !== undefined && input.status !== "ACTIVE"));
    if (leavingOwner) {
      const [counts] = await connection.execute("SELECT COUNT(*) AS total FROM internal_team_members WHERE guild_id = ? AND status = 'ACTIVE' AND group_id = ?", [guildId, existing.groupId]);
      if (Number(counts[0].total) <= 1) throw Object.assign(new Error("The last active Owner cannot be demoted or removed"), { status: 409 });
    }
    if (input.status !== undefined && !STATUSES.has(input.status)) throw Object.assign(new Error("Invalid team status"), { status: 400 });
    const fields = [], values = [];
    for (const [key, column] of [["jobTitle", "job_title"], ["department", "department"], ["responsibilities", "responsibilities"], ["publicRole", "public_role"], ["status", "status"]]) {
      if (input[key] !== undefined) { fields.push(column + " = ?"); values.push(typeof input[key] === "string" ? input[key].trim() : input[key]); }
    }
    if (targetGroupId !== undefined) { fields.push("group_id = ?"); values.push(targetGroupId); }
    if (fields.length) await connection.execute("UPDATE internal_team_members SET " + fields.join(", ") + " WHERE guild_id = ? AND id = ?", [...values, guildId, id]);
    await connection.commit();
    const [rows] = await pool.execute(SELECT_TEAM + " WHERE t.guild_id = ? AND t.id = ? GROUP BY t.id", [guildId, id]);
    return normalizeRows(rows)[0];
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function removeTeamMember(guildId, id, actorIsOwner) {
  const pool = getPool(), connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
    await connection.query("SELECT guild_id FROM guilds WHERE guild_id = ? FOR UPDATE", [guildId]);
    const existing = await lockedTeamRecord(connection, guildId, id);
    if (!existing) throw Object.assign(new Error("Team member not found"), { status: 404 });
    if (existing.groupName === "Owner" && !actorIsOwner) throw Object.assign(new Error("Only an Owner can remove another Owner"), { status: 403 });
    if (existing.groupName === "Owner" && existing.status === "ACTIVE") {
      const [counts] = await connection.execute("SELECT COUNT(*) AS total FROM internal_team_members WHERE guild_id = ? AND status = 'ACTIVE' AND group_id = ?", [guildId, existing.groupId]);
      if (Number(counts[0].total) <= 1) throw Object.assign(new Error("The last active Owner cannot be removed"), { status: 409 });
    }
    await connection.execute("UPDATE internal_team_members SET status = 'REMOVED' WHERE guild_id = ? AND id = ?", [guildId, id]);
    await connection.commit();
    return { ok: true };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function bootstrapOwner(guildId, discordId, username = "Owner") {
  const pool = getPool();
  const connection = await pool.getConnection();
  const safeUsername = String(username || "Owner").trim().slice(0, 100) || "Owner";
  const userId = "discord:" + String(discordId);
  try {
    await connection.beginTransaction();
    await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
    await connection.execute(
      "INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)",
      [userId, String(discordId), safeUsername],
    );
    const [users] = await connection.execute("SELECT id FROM users WHERE discord_id = ? LIMIT 1", [String(discordId)]);
    const actualUserId = users[0].id;
    await connection.execute(
      "INSERT INTO discord_members (id, guild_id, user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)",
      ["member:" + guildId + ":" + discordId, guildId, actualUserId],
    );
    const [members] = await connection.execute("SELECT id FROM discord_members WHERE guild_id = ? AND user_id = ? LIMIT 1", [guildId, actualUserId]);
    const [groups] = await connection.execute("SELECT id FROM permission_groups WHERE name = 'Owner' LIMIT 1");
    if (!groups.length) throw new Error("Owner permission group has not been seeded.");
    await connection.execute(
      "INSERT INTO internal_team_members (id, guild_id, member_id, discord_id, username, public_role, job_title, department, responsibilities, group_id, status) VALUES (?, ?, ?, ?, ?, 'Founder', 'Founder', 'Executive', 'Full control of Overland Finance community operations.', ?, 'ACTIVE') ON DUPLICATE KEY UPDATE username = VALUES(username), public_role = VALUES(public_role), job_title = VALUES(job_title), department = VALUES(department), responsibilities = VALUES(responsibilities), group_id = VALUES(group_id), status = 'ACTIVE'",
      [crypto.randomUUID(), guildId, members[0].id, String(discordId), safeUsername, groups[0].id],
    );
    await connection.commit();
    return { ok: true, discordId: String(discordId) };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
