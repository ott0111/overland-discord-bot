import crypto from "node:crypto";
import { getPool } from "../mysql.js";

async function resolveMember(connection, guildId, user) {
  const discordId = String(typeof user === "string" ? user : user.id);
  const username = String(typeof user === "string" ? discordId : user.username || user.globalName || discordId).slice(0, 100);
  await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
  await connection.execute("INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)", ["discord:" + discordId, discordId, username]);
  const [users] = await connection.execute("SELECT id FROM users WHERE discord_id = ? LIMIT 1", [discordId]);
  await connection.execute("INSERT INTO discord_members (id, guild_id, user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)", ["member:" + guildId + ":" + discordId, guildId, users[0].id]);
  const [members] = await connection.execute("SELECT dm.id, u.discord_id AS discordId, u.username FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id WHERE dm.guild_id = ? AND u.discord_id = ? LIMIT 1", [guildId, discordId]);
  if (!members.length) throw new Error("Unable to resolve referral member.");
  await connection.execute("INSERT IGNORE INTO point_balances (member_id, guild_id) VALUES (?, ?)", [members[0].id, guildId]);
  return members[0];
}

export async function recordInviteCreated(guildId, invite) {
  if (!invite?.code || !invite.inviter?.id) return false;
  const pool = getPool();
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const member = await resolveMember(connection, guildId, invite.inviter);
    await connection.execute("INSERT INTO referral_invites (id, guild_id, member_id, invite_code, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP(3)) ON DUPLICATE KEY UPDATE member_id = VALUES(member_id), revoked_at = NULL", [crypto.randomUUID(), guildId, member.id, String(invite.code)]);
    await connection.execute("INSERT INTO invite_tracking (id, guild_id, invite_code, inviter_id, uses, payload) VALUES (?, ?, ?, ?, ?, JSON_OBJECT()) ON DUPLICATE KEY UPDATE inviter_id = VALUES(inviter_id), uses = VALUES(uses)", [crypto.randomUUID(), guildId, String(invite.code), member.discordId, Number(invite.uses || 0)]);
    await connection.commit();
    return true;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally { connection.release(); }
}

export async function recordReferralJoin(guildId, user, inviteCode) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const referred = await resolveMember(connection, guildId, user);
    const [invites] = await connection.execute("SELECT inviter_id AS inviterId, uses FROM invite_tracking WHERE guild_id = ? AND invite_code = ? LIMIT 1 FOR UPDATE", [guildId, String(inviteCode)]);
    const inviterId = invites[0]?.inviterId;
    if (!inviterId || inviterId === referred.discordId) { await connection.commit(); return null; }
    const referrer = await resolveMember(connection, guildId, inviterId);
    const id = crypto.randomUUID();
    await connection.execute("INSERT IGNORE INTO referrals (id, guild_id, referrer_member_id, referred_member_id, invite_code) VALUES (?, ?, ?, ?, ?)", [id, guildId, referrer.id, referred.id, String(inviteCode)]);
    const [rows] = await connection.execute("SELECT r.id, r.referrer_member_id AS referrerId, r.referred_member_id AS referredId, r.invite_code AS inviteCode, r.verified, r.retained_7d AS retained7d, r.became_comrade AS becameComrade, r.suspicious, r.created_at AS createdAt FROM referrals r WHERE r.guild_id = ? AND r.referrer_member_id = ? AND r.referred_member_id = ? LIMIT 1", [guildId, referrer.id, referred.id]);
    await connection.execute("UPDATE invite_tracking SET uses = ? WHERE guild_id = ? AND invite_code = ?", [Number(invites[0].uses || 0) + 1, guildId, String(inviteCode)]);
    await connection.commit();
    return rows[0] || null;
  } catch (error) {
    await connection.rollback();
    if (error.code === "ER_DUP_ENTRY") return null;
    throw error;
  } finally { connection.release(); }
}

export async function verifyReferralRecord(guildId, referredDiscordId, amount) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT r.id, r.referrer_member_id AS referrerId, r.suspicious, u.discord_id AS referrerDiscordId FROM referrals r INNER JOIN discord_members dm ON dm.id = r.referrer_member_id INNER JOIN users u ON u.id = dm.user_id WHERE r.guild_id = ? AND r.referred_member_id = (SELECT dm2.id FROM discord_members dm2 INNER JOIN users u2 ON u2.id = dm2.user_id WHERE dm2.guild_id = ? AND u2.discord_id = ? LIMIT 1) FOR UPDATE", [guildId, guildId, String(referredDiscordId)]);
    const referral = rows[0];
    if (!referral || referral.suspicious) { await connection.commit(); return false; }
    const [updated] = await connection.execute("UPDATE referrals SET verified = TRUE, verified_at = COALESCE(verified_at, CURRENT_TIMESTAMP(3)) WHERE guild_id = ? AND id = ? AND verified = FALSE", [guildId, referral.id]);
    if (!updated.affectedRows) { await connection.commit(); return false; }
    const [balances] = await connection.execute("SELECT overpoints FROM point_balances WHERE guild_id = ? AND member_id = ? FOR UPDATE", [guildId, referral.referrerId]);
    if (!balances.length) throw new Error("Referrer balance is missing.");
    const key = "referral:" + referral.id;
    await connection.execute("UPDATE point_balances SET overpoints = overpoints + ?, referral_points = referral_points + ?, updated_at = CURRENT_TIMESTAMP(3) WHERE guild_id = ? AND member_id = ?", [amount, amount, guildId, referral.referrerId]);
    await connection.execute("INSERT IGNORE INTO point_transactions (id, guild_id, member_id, currency, category, amount, balance_after, source, idempotency_key, reason, actor_id) VALUES (?, ?, ?, 'OVERPOINTS', 'referral', ?, ?, 'REFERRAL', ?, 'Verified referral', 'SYSTEM')", [crypto.randomUUID(), guildId, referral.referrerId, amount, Number(balances[0].overpoints) + amount, key]);
    await connection.commit();
    return true;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

export async function processReferralMilestonesNormalized(guildId, presentDiscordIds, retentionReward, comradeReward) {
  const connection = await getPool().getConnection();
  const awarded = [];
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute("SELECT r.id, r.referrer_member_id AS referrerId, r.referred_member_id AS referredId, r.retained_7d AS retained7d, r.became_comrade AS becameComrade, u.discord_id AS referredDiscordId, EXISTS(SELECT 1 FROM member_roles mr INNER JOIN roles ro ON ro.id = mr.role_id WHERE mr.guild_id = r.guild_id AND mr.member_id = r.referred_member_id AND ro.name = 'Comrade') AS hasComrade FROM referrals r INNER JOIN discord_members dm ON dm.id = r.referred_member_id INNER JOIN users u ON u.id = dm.user_id WHERE r.guild_id = ? AND r.verified = TRUE AND r.suspicious = FALSE FOR UPDATE", [guildId]);
    for (const row of rows) {
      const present = presentDiscordIds.has(row.referredDiscordId);
      if (!row.retained7d && present) {
        const [age] = await connection.execute("SELECT verified_at FROM referrals WHERE id = ? AND guild_id = ? AND verified_at <= DATE_SUB(CURRENT_TIMESTAMP(3), INTERVAL 7 DAY)", [row.id, guildId]);
        if (age.length) {
          await connection.execute("UPDATE referrals SET retained_7d = TRUE WHERE id = ? AND retained_7d = FALSE", [row.id]);
          await awardMilestone(connection, guildId, row, retentionReward, "retained:" + row.id, "REFERRAL_RETENTION", "Referral retained for seven days");
          awarded.push({ memberId: row.referredDiscordId, type: "retained" });
        }
      }
      if (!row.becameComrade && row.hasComrade) {
        await connection.execute("UPDATE referrals SET became_comrade = TRUE WHERE id = ? AND became_comrade = FALSE", [row.id]);
        await awardMilestone(connection, guildId, row, comradeReward, "comrade:" + row.id, "REFERRAL_COMRADE", "Referral became a Comrade");
        awarded.push({ memberId: row.referredDiscordId, type: "comrade" });
      }
    }
    await connection.commit();
    return awarded;
  } catch (error) { await connection.rollback(); throw error; }
  finally { connection.release(); }
}

async function awardMilestone(connection, guildId, row, amount, key, source, reason) {
  if (!amount) return;
  const [balances] = await connection.execute("SELECT overpoints FROM point_balances WHERE guild_id = ? AND member_id = ? FOR UPDATE", [guildId, row.referrerId]);
  if (!balances.length) return;
  await connection.execute("UPDATE point_balances SET overpoints = overpoints + ?, referral_points = referral_points + ?, updated_at = CURRENT_TIMESTAMP(3) WHERE guild_id = ? AND member_id = ?", [amount, amount, guildId, row.referrerId]);
  await connection.execute("INSERT IGNORE INTO point_transactions (id, guild_id, member_id, currency, category, amount, balance_after, source, idempotency_key, reason, actor_id) VALUES (?, ?, ?, 'OVERPOINTS', 'referral', ?, ?, ?, ?, ?, 'SYSTEM')", [crypto.randomUUID(), guildId, row.referrerId, amount, Number(balances[0].overpoints) + amount, source, key, reason]);
}

export async function referralStatsNormalized(guildId, discordId) {
  const [rows] = await getPool().execute("SELECT r.id, r.invite_code AS inviteCode, r.verified, r.retained_7d AS retained7d, r.became_comrade AS becameComrade, r.suspicious, r.created_at AS createdAt, u.username AS referredUsername, u.discord_id AS referredDiscordId FROM referrals r INNER JOIN discord_members dm ON dm.id = r.referred_member_id INNER JOIN users u ON u.id = dm.user_id WHERE r.guild_id = ? AND r.referrer_member_id = (SELECT dm2.id FROM discord_members dm2 INNER JOIN users u2 ON u2.id = dm2.user_id WHERE dm2.guild_id = ? AND u2.discord_id = ? LIMIT 1) ORDER BY r.created_at DESC", [guildId, guildId, String(discordId)]);
  return { total: rows.length, verified: rows.filter((x) => Boolean(x.verified)).length, retained: rows.filter((x) => Boolean(x.retained7d)).length, rows };
}

export async function listReferralDashboard(guildId) {
  const [rows] = await getPool().execute("SELECT r.id, r.invite_code AS inviteCode, r.verified, r.retained_7d AS retained7d, r.became_comrade AS becameComrade, r.suspicious, r.created_at AS createdAt, ru.username AS referrerUsername, ru.discord_id AS referrerDiscordId, du.username AS referredUsername, du.discord_id AS referredDiscordId FROM referrals r INNER JOIN discord_members rdm ON rdm.id = r.referrer_member_id INNER JOIN users ru ON ru.id = rdm.user_id INNER JOIN discord_members ddm ON ddm.id = r.referred_member_id INNER JOIN users du ON du.id = ddm.user_id WHERE r.guild_id = ? ORDER BY r.created_at DESC LIMIT 100", [guildId]);
  const [stats] = await getPool().execute("SELECT COUNT(*) AS total, SUM(verified = TRUE) AS verified, SUM(retained_7d = TRUE) AS retained, SUM(became_comrade = TRUE) AS comrade, SUM(suspicious = TRUE) AS suspicious FROM referrals WHERE guild_id = ?", [guildId]);
  const s = stats[0] || {};
  return { referrals: rows.map((r) => ({ ...r, verified: Boolean(r.verified), retained7d: Boolean(r.retained7d), becameComrade: Boolean(r.becameComrade), suspicious: Boolean(r.suspicious), referrer: { user: { username: r.referrerUsername, discordId: r.referrerDiscordId } }, referred: { user: { username: r.referredUsername, discordId: r.referredDiscordId } } })), stats: Object.fromEntries(["total","verified","retained","comrade","suspicious"].map((key) => [key, Number(s[key] || 0)])) };
}
