import { getPool } from "../mysql.js";

export async function listMembers(guildId, { q = "", page = 1, limit = 20 } = {}) {
  const pool = getPool();
  const search = String(q).trim();
  const where = search ? " AND (u.username LIKE ? OR u.discord_id LIKE ?)" : "";
  const params = search ? [guildId, "%" + search + "%", "%" + search + "%"] : [guildId];
  const [countRows] = await pool.execute(
    "SELECT COUNT(*) AS total FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id WHERE dm.guild_id = ?" + where,
    params,
  );
  const offset = (page - 1) * limit;
  const [rows] = await pool.execute(
    "SELECT dm.id, dm.guild_id AS guildId, dm.user_id AS userId, dm.joined_at AS joinedAt, dm.verified_at AS verifiedAt, dm.x_follow_verified AS xFollowVerified, dm.x_follow_verified_at AS xFollowVerifiedAt, dm.is_suspicious AS isSuspicious, dm.last_message_at AS lastMessageAt, dm.message_count AS messageCount, dm.profile, dm.created_at AS createdAt, dm.updated_at AS updatedAt, u.discord_id AS discordId, u.username, u.avatar_url AS avatarUrl, pb.overpoints, pb.overcredits, pb.community_points AS communityPoints, pb.social_points AS socialPoints, pb.referral_points AS referralPoints, pb.contribution_points AS contributionPoints FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id LEFT JOIN point_balances pb ON pb.member_id = dm.id WHERE dm.guild_id = ?" + where + " ORDER BY dm.created_at DESC LIMIT ? OFFSET ?",
    [...params, limit, offset],
  );
  const ids = rows.map((row) => row.id);
  let roleMap = new Map();
  if (ids.length) {
    const placeholders = ids.map(() => "?").join(",");
    const [roleRows] = await pool.execute(
      "SELECT mr.member_id AS memberId, mr.role_id AS roleId, mr.granted_at AS grantedAt, mr.expires_at AS expiresAt, r.name, r.description, r.discord_role_id AS discordRoleId, r.is_internal AS isInternal, r.is_self_assignable AS isSelfAssignable FROM member_roles mr INNER JOIN roles r ON r.id = mr.role_id WHERE mr.member_id IN (" + placeholders + ")",
      ids,
    );
    roleMap = new Map();
    for (const role of roleRows) {
      if (!roleMap.has(role.memberId)) roleMap.set(role.memberId, []);
      roleMap.get(role.memberId).push({
        roleId: role.roleId, memberId: role.memberId, grantedAt: role.grantedAt, expiresAt: role.expiresAt,
        role: { id: role.roleId, name: role.name, description: role.description, discordRoleId: role.discordRoleId, isInternal: Boolean(role.isInternal), isSelfAssignable: Boolean(role.isSelfAssignable) },
      });
    }
  }
  const items = rows.map((row) => ({
    id: row.id, guildId: row.guildId, userId: row.userId, joinedAt: row.joinedAt, verifiedAt: row.verifiedAt,
    xFollowVerified: Boolean(row.xFollowVerified), xFollowVerifiedAt: row.xFollowVerifiedAt,
    isSuspicious: Boolean(row.isSuspicious), lastMessageAt: row.lastMessageAt, messageCount: row.messageCount,
    profile: row.profile, createdAt: row.createdAt, updatedAt: row.updatedAt,
    user: { id: row.userId, discordId: row.discordId, username: row.username, avatarUrl: row.avatarUrl },
    balance: row.overpoints === null ? null : {
      memberId: row.id, overpoints: row.overpoints, overcredits: row.overcredits,
      communityPoints: row.communityPoints, socialPoints: row.socialPoints,
      referralPoints: row.referralPoints, contributionPoints: row.contributionPoints,
    },
    roles: roleMap.get(row.id) || [],
  }));
  const total = Number(countRows[0]?.total || 0);
  return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
}

export async function getMemberDetails(guildId, memberId) {
  const pool = getPool();
  const [rows] = await pool.execute(
    "SELECT dm.id, dm.guild_id AS guildId, dm.user_id AS userId, dm.joined_at AS joinedAt, dm.verified_at AS verifiedAt, dm.x_follow_verified AS xFollowVerified, dm.x_follow_verified_at AS xFollowVerifiedAt, dm.is_suspicious AS isSuspicious, dm.last_message_at AS lastMessageAt, dm.message_count AS messageCount, dm.profile, dm.created_at AS createdAt, dm.updated_at AS updatedAt, u.discord_id AS discordId, u.username, u.avatar_url AS avatarUrl, pb.overpoints, pb.overcredits, pb.community_points AS communityPoints, pb.social_points AS socialPoints, pb.referral_points AS referralPoints, pb.contribution_points AS contributionPoints FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id LEFT JOIN point_balances pb ON pb.member_id = dm.id WHERE dm.guild_id = ? AND dm.id = ? LIMIT 1",
    [guildId, memberId],
  );
  if (!rows.length) return null;
  const row = rows[0];
  const [roles] = await pool.execute(
    "SELECT mr.role_id AS roleId, mr.granted_at AS grantedAt, mr.expires_at AS expiresAt, r.name, r.description, r.discord_role_id AS discordRoleId, r.is_internal AS isInternal, r.is_self_assignable AS isSelfAssignable FROM member_roles mr INNER JOIN roles r ON r.id = mr.role_id WHERE mr.member_id = ?",
    [memberId],
  );
  const [achievements] = await pool.execute(
    "SELECT ma.id, ma.awarded_at AS awardedAt, a.id AS achievementId, a.achievement_key AS achievementKey, a.name, a.description, a.kind, a.threshold, a.overpoints_reward AS overpointsReward, a.overcredits_reward AS overcreditsReward FROM member_achievements ma INNER JOIN achievements a ON a.id = ma.achievement_id WHERE ma.member_id = ? ORDER BY ma.awarded_at DESC",
    [memberId],
  );
  const [transactions] = await pool.execute(
    "SELECT id, guild_id AS guildId, member_id AS memberId, currency, category, amount, balance_after AS balanceAfter, source, idempotency_key AS idempotencyKey, reason, actor_id AS actorId, created_at AS createdAt FROM point_transactions WHERE guild_id = ? AND member_id = ? ORDER BY created_at DESC LIMIT 20",
    [guildId, memberId],
  );
  const [checkins] = await pool.execute(
    "SELECT id, guild_id AS guildId, member_id AS memberId, checkin_date AS date, streak, created_at AS createdAt FROM daily_checkins WHERE guild_id = ? AND member_id = ? ORDER BY checkin_date DESC LIMIT 30",
    [guildId, memberId],
  );
  const [referralsGiven] = await pool.execute(
    "SELECT id, guild_id AS guildId, referrer_member_id AS referrerMemberId, referred_member_id AS referredMemberId, invite_code AS inviteCode, verified, verified_at AS verifiedAt, retained_7d AS retained7d, became_comrade AS becameComrade, suspicious, created_at AS createdAt FROM referrals WHERE guild_id = ? AND referrer_member_id = ? ORDER BY created_at DESC",
    [guildId, memberId],
  );
  const [referralsReceived] = await pool.execute(
    "SELECT id, guild_id AS guildId, referrer_member_id AS referrerMemberId, referred_member_id AS referredMemberId, invite_code AS inviteCode, verified, verified_at AS verifiedAt, retained_7d AS retained7d, became_comrade AS becameComrade, suspicious, created_at AS createdAt FROM referrals WHERE guild_id = ? AND referred_member_id = ? ORDER BY created_at DESC",
    [guildId, memberId],
  );
  return {
    id: row.id, guildId: row.guildId, userId: row.userId, joinedAt: row.joinedAt, verifiedAt: row.verifiedAt,
    xFollowVerified: Boolean(row.xFollowVerified), xFollowVerifiedAt: row.xFollowVerifiedAt,
    isSuspicious: Boolean(row.isSuspicious), lastMessageAt: row.lastMessageAt, messageCount: row.messageCount,
    profile: row.profile, createdAt: row.createdAt, updatedAt: row.updatedAt,
    user: { id: row.userId, discordId: row.discordId, username: row.username, avatarUrl: row.avatarUrl },
    balance: row.overpoints === null ? null : {
      memberId: row.id, overpoints: row.overpoints, overcredits: row.overcredits,
      communityPoints: row.communityPoints, socialPoints: row.socialPoints,
      referralPoints: row.referralPoints, contributionPoints: row.contributionPoints,
    },
    roles: roles.map((r) => ({
      roleId: r.roleId, memberId, grantedAt: r.grantedAt, expiresAt: r.expiresAt,
      role: { id: r.roleId, name: r.name, description: r.description, discordRoleId: r.discordRoleId, isInternal: Boolean(r.isInternal), isSelfAssignable: Boolean(r.isSelfAssignable) },
    })),
    achievements: achievements.map((a) => ({
      id: a.id, awardedAt: a.awardedAt,
      achievement: { id: a.achievementId, key: a.achievementKey, name: a.name, description: a.description, kind: a.kind, threshold: a.threshold, overpointsReward: a.overpointsReward, overcreditsReward: a.overcreditsReward },
    })),
    transactions, checkins, referralsGiven, referralsReceived,
  };
}
