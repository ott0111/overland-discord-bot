import crypto from "node:crypto";
import { getPool } from "../mysql.js";

const ALLOWED_PERMISSION_KEYS = new Set([
  "team.view","team.manage","roles.assign","roles.manage","economy.adjust","economy.view",
  "campaigns.manage","campaigns.review","community.manage","referrals.view","rewards.manage","rewards.review",
  "tickets.view","tickets.manage","moderation.action","moderation.view","config.manage",
  "x.manage","analytics.view","audit.view","achievements.manage",
]);

export async function listPermissionGroups(guildId) {
  const [groups] = await getPool().execute(
    "SELECT pg.id, pg.name, pg.description, (SELECT COUNT(*) FROM internal_team_members tm WHERE tm.group_id = pg.id AND tm.guild_id = ? AND tm.status = 'ACTIVE') AS memberCount FROM permission_groups pg ORDER BY pg.name ASC",
    [guildId],
  );
  const [permissions] = await getPool().execute(
    "SELECT group_id AS groupId, permission_key AS `key`, description FROM permissions ORDER BY permission_key ASC",
  );
  return groups.map((group) => ({
    ...group,
    _count: { members: Number(group.memberCount || 0) },
    permissions: permissions.filter((permission) => permission.groupId === group.id),
  }));
}

export async function replaceGroupPermissions(guildId, groupId, keys, actorId) {
  if (!Array.isArray(keys)) throw Object.assign(new Error("keys must be an array"), { status: 400 });
  const valid = [...new Set(keys.filter((key) => typeof key === "string" && ALLOWED_PERMISSION_KEYS.has(key)))];
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [groups] = await connection.execute("SELECT id, name FROM permission_groups WHERE id = ? LIMIT 1 FOR UPDATE", [groupId]);
    if (!groups.length) throw Object.assign(new Error("Permission group not found"), { status: 404 });
    await connection.execute("DELETE FROM permissions WHERE group_id = ?", [groupId]);
    for (const key of valid) {
      await connection.execute(
        "INSERT INTO permissions (id, group_id, permission_key, description) VALUES (?, ?, ?, ?)",
        [crypto.randomUUID(), groupId, key, "Managed permission: " + key],
      );
    }
    await connection.execute(
      "INSERT INTO audit_logs (id, guild_id, actor_id, action, entity_type, entity_id, details) VALUES (?, ?, ?, 'permissions.update', 'PermissionGroup', ?, ?)",
      [crypto.randomUUID(), guildId, actorId, groupId, JSON.stringify({ group: groups[0].name, keys: valid })],
    );
    await connection.commit();
    return { ok: true, groupId, keys: valid };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
