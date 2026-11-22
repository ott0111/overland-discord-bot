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
    required.name AS requiresRoleName, (SELECT COUNT(*) FROM member_roles mr WHERE mr.role_id = r.id) AS memberCount
  FROM roles r
  LEFT JOIN roles required ON required.id = r.requires_role_id
`;

export async function listRoles(guildId) {
  const [rows] = await getPool().execute(
    SELECT_ROLES + " WHERE r.guild_id = ? ORDER BY r.sort_order ASC, r.name ASC",
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
  const [orderRows] = await pool.execute("SELECT COALESCE(MAX(sort_order), -1) + 1 AS nextOrder FROM roles WHERE guild_id = ?", [guildId]);
  await pool.execute(
    "INSERT INTO roles (id, guild_id, name, description, is_internal, is_self_assignable, discord_role_id, sort_order, config) VALUES (?, ?, ?, ?, FALSE, ?, ?, ?, ?)",
    [id, guildId, name, input.description ? String(input.description).slice(0, 2000) : null, Boolean(input.isSelfAssignable), input.discordRoleId || null, Number(orderRows[0]?.nextOrder || 0), JSON.stringify(input.config || {})],
  );
  const [rows] = await pool.execute(SELECT_ROLES + " WHERE r.guild_id = ? AND r.id = ? LIMIT 1", [guildId, id]);
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
  const [rows] = await pool.execute(SELECT_ROLES + " WHERE r.guild_id = ? AND r.id = ? LIMIT 1", [guildId, id]);
  return mapRole(rows[0]);
}

export async function getRoleGuideConfig(guildId) {
  const [rows] = await getPool().execute(
    "SELECT config_value FROM bot_configuration WHERE guild_id = ? AND config_key = 'role_guide' LIMIT 1",
    [guildId],
  );
  return rows.length ? parseJson(rows[0].config_value) : {};
}

export async function saveRoleGuideConfig(guildId, config, actorId) {
  const id = crypto.randomUUID();
  await getPool().execute(
    "INSERT INTO bot_configuration (id, guild_id, config_key, config_value, updated_by) VALUES (?, ?, 'role_guide', ?, ?) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_by = VALUES(updated_by)",
    [id, guildId, JSON.stringify(config), actorId || null],
  );
  return config;
}

async function resolveRoleMember(connection, guildId, user) {
  const discordId = String(typeof user === "string" ? user : user.id);
  const username = String(typeof user === "string" ? discordId : user.username || user.globalName || discordId).slice(0, 100);
  await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
  const userId = "discord:" + discordId;
  await connection.execute(
    "INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)",
    [userId, discordId, username],
  );
  await connection.execute(
    "INSERT IGNORE INTO discord_members (id, guild_id, user_id) VALUES (?, ?, ?)",
    ["member:" + guildId + ":" + discordId, guildId, userId],
  );
  const [rows] = await connection.execute(
    "SELECT dm.id, dm.verified_at AS verifiedAt, dm.x_follow_verified AS xFollowVerified, dm.is_suspicious AS isSuspicious, dm.profile, u.discord_id AS discordId FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id WHERE dm.guild_id = ? AND u.discord_id = ? LIMIT 1",
    [guildId, discordId],
  );
  if (!rows.length) throw new Error("Unable to resolve guild member.");
  await connection.execute("INSERT IGNORE INTO point_balances (member_id, guild_id) VALUES (?, ?)", [rows[0].id, guildId]);
  return { ...rows[0], xFollowVerified: Boolean(rows[0].xFollowVerified), isSuspicious: Boolean(rows[0].isSuspicious) };
}

export async function grantMemberRole(guildId, user, roleName, actorId, reason = "Role awarded") {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const member = await resolveRoleMember(connection, guildId, user);
    const [roles] = await connection.execute(
      "SELECT id, name, is_internal AS isInternal, requires_role_id AS requiresRoleId, config FROM roles WHERE guild_id = ? AND LOWER(name) = LOWER(?) LIMIT 1",
      [guildId, String(roleName)],
    );
    if (!roles.length) throw Object.assign(new Error("Unknown Overland role."), { status: 404 });
    const role = roles[0];
    if (role.isInternal) throw new Error("Internal roles are managed through the private team system.");
    const config = parseJson(role.config);
    if (config.requireVerified && !member.verifiedAt) throw new Error("This role requires completed verification first.");
    if (config.requireXFollow && !member.xFollowVerified) throw new Error("This role requires verified X follow status.");
    if (role.requiresRoleId) {
      const [prerequisite] = await connection.execute(
        "SELECT id FROM member_roles WHERE member_id = ? AND role_id = ? LIMIT 1",
        [member.id, role.requiresRoleId],
      );
      if (!prerequisite.length) throw new Error("This role requires its prerequisite role first.");
    }
    const [inserted] = await connection.execute(
      "INSERT IGNORE INTO member_roles (id, guild_id, member_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP(3))",
      [crypto.randomUUID(), guildId, member.id, role.id, actorId || null],
    );
    if (inserted.affectedRows) {
      await connection.execute(
        "INSERT INTO role_history (id, guild_id, member_id, role_id, action, actor_id, reason) VALUES (?, ?, ?, ?, 'GRANTED', ?, ?)",
        [crypto.randomUUID(), guildId, member.id, role.id, actorId || "SYSTEM", String(reason).slice(0, 1000)],
      );
    }
    await connection.commit();
    return inserted.affectedRows > 0;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function revokeMemberRole(guildId, user, roleName, actorId, reason = "Role removed") {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const member = await resolveRoleMember(connection, guildId, user);
    const [roles] = await connection.execute(
      "SELECT id, name, is_internal AS isInternal FROM roles WHERE guild_id = ? AND LOWER(name) = LOWER(?) LIMIT 1",
      [guildId, String(roleName)],
    );
    if (!roles.length || roles[0].isInternal) throw new Error("That role cannot be removed here.");
    const root = roles[0];
    const [dependents] = await connection.execute("SELECT id, name FROM roles WHERE guild_id = ? AND requires_role_id = ? AND is_internal = FALSE", [guildId, root.id]);
    const remove = [root, ...dependents];
    for (const role of remove) {
      const [assigned] = await connection.execute("DELETE FROM member_roles WHERE member_id = ? AND role_id = ?", [member.id, role.id]);
      if (assigned.affectedRows) {
        await connection.execute(
          "INSERT INTO role_history (id, guild_id, member_id, role_id, action, actor_id, reason) VALUES (?, ?, ?, ?, 'REVOKED', ?, ?)",
          [crypto.randomUUID(), guildId, member.id, role.id, actorId || "SYSTEM", String(reason).slice(0, 1000)],
        );
      }
    }
    await connection.commit();
    return remove.map((role) => role.name);
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function evaluateMemberRoles(guildId, user) {
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const member = await resolveRoleMember(connection, guildId, user);
    const [balances] = await connection.execute("SELECT overpoints FROM point_balances WHERE member_id = ? LIMIT 1", [member.id]);
    const overpoints = Number(balances[0]?.overpoints || 0);
    const [assignedRows] = await connection.execute("SELECT role_id FROM member_roles WHERE member_id = ?", [member.id]);
    const assigned = new Set(assignedRows.map((row) => row.role_id));
    const [roles] = await connection.execute(
      "SELECT id, name, requires_role_id AS requiresRoleId, min_overpoints AS minOverpoints, config FROM roles WHERE guild_id = ? AND is_internal = FALSE ORDER BY sort_order ASC, name ASC",
      [guildId],
    );
    const [staffRows] = await connection.execute(
      "SELECT id FROM internal_team_members WHERE guild_id = ? AND member_id = ? AND status = 'ACTIVE' LIMIT 1",
      [guildId, member.id],
    );
    const earned = [];
    for (const role of roles) {
      if (assigned.has(role.id)) continue;
      const config = parseJson(role.config);
      if (config.excludeActiveStaff && staffRows.length) continue;
      if (config.requireVerified && !member.verifiedAt) continue;
      if (config.requireXFollow && !member.xFollowVerified) continue;
      if (role.requiresRoleId && !assigned.has(role.requiresRoleId)) continue;
      if (role.minOverpoints !== null && overpoints < Number(role.minOverpoints)) continue;
      const progression = config.progression || {};
      if (progression.kind === "minimum_overpoints" && overpoints < Number(progression.minimum || 0)) continue;
      if (progression.kind === "approved_submission_count") {
        const categories = Array.isArray(progression.categories) ? progression.categories.filter((x) => typeof x === "string").slice(0, 20) : [];
        const minimum = Number(progression.minimum || 0);
        if (!categories.length || !Number.isSafeInteger(minimum) || minimum < 1) continue;
        const placeholders = categories.map(() => "?").join(",");
        const [counts] = await connection.execute(
          "SELECT COUNT(*) AS total FROM campaign_submissions WHERE guild_id = ? AND member_id = ? AND status = 'APPROVED' AND category IN (" + placeholders + ")",
          [guildId, member.id, ...categories],
        );
        if (Number(counts[0]?.total || 0) < minimum) continue;
      }
      await connection.execute(
        "INSERT IGNORE INTO member_roles (id, guild_id, member_id, role_id, granted_by, granted_at) VALUES (?, ?, ?, ?, 'SYSTEM', CURRENT_TIMESTAMP(3))",
        [crypto.randomUUID(), guildId, member.id, role.id],
      );
      const [nowAssigned] = await connection.execute("SELECT id FROM member_roles WHERE member_id = ? AND role_id = ? LIMIT 1", [member.id, role.id]);
      if (nowAssigned.length) {
        assigned.add(role.id);
        await connection.execute(
          "INSERT INTO role_history (id, guild_id, member_id, role_id, action, actor_id, reason) VALUES (?, ?, ?, ?, 'GRANTED', 'SYSTEM', 'Automatic role progression')",
          [crypto.randomUUID(), guildId, member.id, role.id],
        );
        earned.push(role.name);
      }
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

export async function getMemberVerification(guildId, user) {
  const connection = await getPool().getConnection();
  try {
    const member = await resolveRoleMember(connection, guildId, user);
    return {
      memberId: member.id,
      discordId: member.discordId,
      verifiedAt: member.verifiedAt,
      xFollowVerified: member.xFollowVerified,
      isSuspicious: member.isSuspicious,
      profile: parseJson(member.profile),
    };
  } finally {
    connection.release();
  }
}

export async function acceptMemberRules(guildId, user, acceptedAt = new Date().toISOString()) {
  const connection = await getPool().getConnection();
  try {
    const member = await resolveRoleMember(connection, guildId, user);
    await connection.execute(
      "UPDATE discord_members SET profile = JSON_SET(COALESCE(profile, JSON_OBJECT()), '$.rulesAcceptedAt', ?) WHERE guild_id = ? AND id = ?",
      [acceptedAt, guildId, member.id],
    );
    return acceptedAt;
  } finally {
    connection.release();
  }
}

export async function saveVerificationChallenge(guildId, user, challenge) {
  const connection = await getPool().getConnection();
  try {
    const member = await resolveRoleMember(connection, guildId, user);
    if (challenge === null) {
      await connection.execute(
        "UPDATE discord_members SET profile = JSON_REMOVE(COALESCE(profile, JSON_OBJECT()), '$.verificationChallenge') WHERE guild_id = ? AND id = ?",
        [guildId, member.id],
      );
    } else {
      await connection.execute(
        "UPDATE discord_members SET profile = JSON_SET(COALESCE(profile, JSON_OBJECT()), '$.verificationChallenge', CAST(? AS JSON)) WHERE guild_id = ? AND id = ?",
        [JSON.stringify(challenge), guildId, member.id],
      );
    }
    return challenge;
  } finally {
    connection.release();
  }
}

export async function completeMemberVerification(guildId, user, verifiedAt = new Date().toISOString()) {
  const connection = await getPool().getConnection();
  try {
    const member = await resolveRoleMember(connection, guildId, user);
    await connection.execute(
      "UPDATE discord_members SET verified_at = ?, is_suspicious = FALSE, profile = JSON_REMOVE(COALESCE(profile, JSON_OBJECT()), '$.verificationChallenge') WHERE guild_id = ? AND id = ?",
      [verifiedAt, guildId, member.id],
    );
    return verifiedAt;
  } finally {
    connection.release();
  }
}

export async function resetMemberVerification(guildId, user) {
  const connection = await getPool().getConnection();
  try {
    const member = await resolveRoleMember(connection, guildId, user);
    await connection.execute(
      "UPDATE discord_members SET verified_at = NULL, profile = JSON_REMOVE(COALESCE(profile, JSON_OBJECT()), '$.verificationChallenge') WHERE guild_id = ? AND id = ?",
      [guildId, member.id],
    );
    return true;
  } finally {
    connection.release();
  }
}

export async function setMemberXFollow(guildId, user, following) {
  const connection = await getPool().getConnection();
  try {
    const member = await resolveRoleMember(connection, guildId, user);
    await connection.execute(
      "UPDATE discord_members SET x_follow_verified = ?, x_follow_verified_at = ? WHERE guild_id = ? AND id = ?",
      [Boolean(following), following ? new Date() : null, guildId, member.id],
    );
    return Boolean(following);
  } finally {
    connection.release();
  }
}

export async function setMemberSuspicious(guildId, user, suspicious) {
  const connection = await getPool().getConnection();
  try {
    const member = await resolveRoleMember(connection, guildId, user);
    await connection.execute(
      "UPDATE discord_members SET is_suspicious = ? WHERE guild_id = ? AND id = ?",
      [Boolean(suspicious), guildId, member.id],
    );
    return Boolean(suspicious);
  } finally {
    connection.release();
  }
}
