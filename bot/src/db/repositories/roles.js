import crypto from "node:crypto";
import { getPool } from "../mysql.js";

function parseJson(value, fallback = {}) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function mapRole(row) {
  return {
    id: row.id,
    guildId: row.guildId,
    name: row.name,
    description: row.description,
    isInternal: Boolean(row.isInternal),
    isSelfAssignable: Boolean(row.isSelfAssignable),
    discordRoleId: row.discordRoleId,
    requiresRoleId: row.requiresRoleId,
    minOverpoints: row.minOverpoints === null ? null : Number(row.minOverpoints),
    sortOrder: Number(row.sortOrder || 0),
    config: parseJson(row.config),
    requiresRole: row.requiresRoleId ? { id: row.requiresRoleId, name: row.requiresRoleName } : null,
    _count: { members: Number(row.memberCount || 0) },
  };
}

const SELECT_ROLES = `
  SELECT r.id, r.guild_id AS guildId, r.name, r.description,
    r.is_internal AS isInternal, r.is_self_assignable AS isSelfAssignable,
    r.discord_role_id AS discordRoleId, r.requires_role_id AS requiresRoleId,
    r.min_overpoints AS minOverpoints, r.sort_order AS sortOrder, r.config,
    required.name AS requiresRoleName, COUNT(mr.member_id) AS memberCount
  FROM roles r
  LEFT JOIN roles required ON required.id = r.requires_role_id
  LEFT JOIN member_roles mr ON mr.role_id = r.id
`;

export async function listRoles(guildId) {
  const [rows] = await getPool().execute(
    SELECT_ROLES + " WHERE r.guild_id = ? GROUP BY r.id ORDER BY r.sort_order ASC, r.name ASC",
    [guildId],
  );
  return rows.map(mapRole);
}

export async function createRole(guildId, input) {
  const pool = getPool();
  const id = crypto.randomUUID();
  const name = String(input.name || "").trim().slice(0, 100);
  if (!name) throw Object.assign(new Error("Role name is required"), { status: 400 });
  const [existing] = await pool.execute("SELECT id FROM roles WHERE guild_id = ? AND LOWER(name) = LOWER(?) LIMIT 1", [guildId, name]);
  if (existing.length) throw Object.assign(new Error("A role with that name already exists"), { status: 409 });
  await pool.execute(
    "INSERT INTO roles (id, guild_id, name, description, is_internal, is_self_assignable, discord_role_id, sort_order, config) VALUES (?, ?, ?, ?, FALSE, ?, ?, COALESCE((SELECT next_order FROM (SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM roles WHERE guild_id = ?) x), 0), ?)",
    [id, guildId, name, input.description ? String(input.description).slice(0, 2000) : null, Boolean(input.isSelfAssignable), input.discordRoleId || null, guildId, JSON.stringify(input.config || {})],
  );
  const [rows] = await pool.execute(SELECT_ROLES + " WHERE r.guild_id = ? AND r.id = ? GROUP BY r.id LIMIT 1", [guildId, id]);
  return mapRole(rows[0]);
}

export async function updateRole(guildId, id, input) {
  const pool = getPool();
  const [found] = await pool.execute("SELECT id, config FROM roles WHERE guild_id = ? AND id = ? LIMIT 1", [guildId, id]);
  if (!found.length) throw Object.assign(new Error("Role not found"), { status: 404 });
  const currentConfig = parseJson(found[0].config);
  const nextConfig = input.config && typeof input.config === "object" ? { ...currentConfig, ...input.config } : currentConfig;
  const fields = [];
  const values = [];
  const add = (column, value) => { fields.push(column + " = ?"); values.push(value); };
  if (input.description !== undefined) add("description", input.description === null ? null : String(input.description).slice(0, 2000));
  if (input.isSelfAssignable !== undefined) add("is_self_assignable", Boolean(input.isSelfAssignable));
  if (input.requiresRoleId !== undefined) {
    if (input.requiresRoleId) {
      const [required] = await pool.execute("SELECT id FROM roles WHERE guild_id = ? AND id = ? AND is_internal = FALSE LIMIT 1", [guildId, input.requiresRoleId]);
      if (!required.length) throw Object.assign(new Error("Prerequisite role was not found in this server"), { status: 400 });
      if (input.requiresRoleId === id) throw Object.assign(new Error("A role cannot require itself"), { status: 400 });
    }
    add("requires_role_id", input.requiresRoleId || null);
  }
  if (input.minOverpoints !== undefined) {
    if (input.minOverpoints !== null && (!Number.isSafeInteger(input.minOverpoints) || input.minOverpoints < 0)) {
      throw Object.assign(new Error("Minimum Overpoints must be a non-negative whole number or null"), { status: 400 });
    }
    add("min_overpoints", input.minOverpoints);
  }
  if (input.discordRoleId !== undefined) add("discord_role_id", input.discordRoleId || null);
  if (input.sortOrder !== undefined) {
    if (!Number.isSafeInteger(input.sortOrder)) throw Object.assign(new Error("Sort order must be a whole number"), { status: 400 });
    add("sort_order", input.sortOrder);
  }
  if (input.config !== undefined) add("config", JSON.stringify(nextConfig));
  if (fields.length) await pool.execute("UPDATE roles SET " + fields.join(", ") + " WHERE guild_id = ? AND id = ?", [...values, guildId, id]);
  const [rows] = await pool.execute(SELECT_ROLES + " WHERE r.guild_id = ? AND r.id = ? GROUP BY r.id LIMIT 1", [guildId, id]);
  return mapRole(rows[0]);
}
