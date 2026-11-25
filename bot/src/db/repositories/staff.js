import { getPool } from "../mysql.js";

export async function findStaffMember(guildId, discordId) {
  const [rows] = await getPool().execute(
    `SELECT
      t.discord_id AS discordId,
      t.username,
      pg.name AS groupName,
      p.permission_key AS permissionKey
    FROM internal_team_members t
    INNER JOIN permission_groups pg ON pg.id = t.group_id
    LEFT JOIN permissions p ON p.group_id = pg.id
    WHERE t.guild_id = ? AND t.discord_id = ? AND t.status = 'ACTIVE'
    ORDER BY p.permission_key ASC`,
    [guildId, discordId],
  );

  if (!rows.length) return null;
  return {
    discordId: rows[0].discordId,
    username: rows[0].username,
    group: rows[0].groupName,
    permissions: [...new Set(rows.map((row) => row.permissionKey).filter(Boolean))],
  };
}
