import crypto from "node:crypto";
import { getPool } from "../mysql.js";

export const CAMPAIGN_CATEGORIES = [
  "social_post", "infographic", "educational_thread", "article", "campaign_contribution",
  "video", "graphic_design", "industry_research", "contribution_article", "product_feedback",
  "community_initiative", "significant_contribution",
];
const SOCIAL = new Set(["social_post", "infographic", "video", "graphic_design"]);
const CONTRIBUTION = new Set(["industry_research", "article", "educational_thread", "contribution_article", "product_feedback", "community_initiative", "significant_contribution"]);

function parseJson(value, fallback = []) {
  if (!value) return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}
function mapCampaign(row) {
  return {
    id: row.id, guildId: row.guildId, name: row.name, description: row.description,
    objectives: row.objectives, startsAt: row.startsAt, endsAt: row.endsAt,
    tasks: parseJson(row.tasks), pointReward: Number(row.pointReward || 0),
    submissionRequirements: row.submissionRequirements, status: row.status,
    createdBy: row.createdBy, createdAt: row.createdAt,
    _count: { submissions: Number(row.submissionCount || 0) },
  };
}
async function resolveMember(connection, guildId, user) {
  const discordId = String(typeof user === "string" ? user : user.id);
  const username = String(typeof user === "string" ? discordId : user.username || user.globalName || discordId).slice(0, 100);
  await connection.execute("INSERT IGNORE INTO guilds (guild_id, settings, stats) VALUES (?, JSON_OBJECT(), JSON_OBJECT())", [guildId]);
  await connection.execute(
    "INSERT INTO users (id, discord_id, username) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE username = VALUES(username)",
    ["discord:" + discordId, discordId, username],
  );
  const [users] = await connection.execute("SELECT id FROM users WHERE discord_id = ? LIMIT 1", [discordId]);
  await connection.execute(
    "INSERT INTO discord_members (id, guild_id, user_id) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE user_id = VALUES(user_id)",
    ["member:" + guildId + ":" + discordId, guildId, users[0].id],
  );
  const [members] = await connection.execute(
    "SELECT dm.id, u.username, u.discord_id AS discordId FROM discord_members dm INNER JOIN users u ON u.id = dm.user_id WHERE dm.guild_id = ? AND u.discord_id = ? LIMIT 1",
    [guildId, discordId],
  );
  if (!members.length) throw new Error("Unable to resolve guild member.");
  await connection.execute("INSERT IGNORE INTO point_balances (member_id, guild_id) VALUES (?, ?)", [members[0].id, guildId]);
  return members[0];
}

const CAMPAIGN_SELECT = `
  SELECT c.id, c.guild_id AS guildId, c.name, c.description, c.objectives,
    c.starts_at AS startsAt, c.ends_at AS endsAt, c.tasks,
    c.point_reward AS pointReward, c.submission_requirements AS submissionRequirements,
    c.status, c.created_by AS createdBy, c.created_at AS createdAt,
    (SELECT COUNT(*) FROM campaign_submissions s WHERE s.campaign_id = c.id) AS submissionCount
  FROM campaigns c
`;

export async function listCampaignDashboard(guildId) {
  const pool = getPool();
  const [campaignRows] = await pool.execute(CAMPAIGN_SELECT + " WHERE c.guild_id = ? ORDER BY c.created_at DESC", [guildId]);
  const [submissionRows] = await pool.execute(
    "SELECT s.id, s.content, s.link_url AS linkUrl, s.image_url AS imageUrl, s.status, s.feedback, s.points_awarded AS pointsAwarded, s.created_at AS createdAt, s.category, s.campaign_id AS campaignId, c.name AS campaignName, u.username, u.discord_id AS discordId FROM campaign_submissions s INNER JOIN campaigns c ON c.id = s.campaign_id INNER JOIN discord_members dm ON dm.id = s.member_id INNER JOIN users u ON u.id = dm.user_id WHERE s.guild_id = ? ORDER BY s.created_at DESC LIMIT 100",
    [guildId],
  );
  return {
    campaigns: campaignRows.map(mapCampaign),
    submissions: submissionRows.map((row) => ({
      id: row.id, content: row.content, linkUrl: row.linkUrl, imageUrl: row.imageUrl,
      status: row.status, feedback: row.feedback, pointsAwarded: Number(row.pointsAwarded || 0),
      createdAt: row.createdAt, category: row.category, campaignId: row.campaignId,
      campaign: { name: row.campaignName },
      member: { user: { username: row.username, discordId: row.discordId } },
    })),
  };
}

export async function listActiveCampaigns(guildId) {
  const [rows] = await getPool().execute(
    CAMPAIGN_SELECT + " WHERE c.guild_id = ? AND c.status = 'ACTIVE' AND c.starts_at <= CURRENT_TIMESTAMP(3) AND c.ends_at > CURRENT_TIMESTAMP(3) ORDER BY c.ends_at ASC",
    [guildId],
  );
  return rows.map(mapCampaign);
}

export async function getCampaign(guildId, campaignId) {
  const [rows] = await getPool().execute(CAMPAIGN_SELECT + " WHERE c.guild_id = ? AND c.id = ? LIMIT 1", [guildId, campaignId]);
  return rows.length ? mapCampaign(rows[0]) : null;
}

export async function listMemberSubmissions(guildId, discordId, campaignId = null) {
  const params = [guildId, discordId];
  let filter = "";
  if (campaignId) { filter = " AND s.campaign_id = ?"; params.push(campaignId); }
  const [rows] = await getPool().execute(
    "SELECT s.id, s.content, s.category, s.link_url AS linkUrl, s.status, s.feedback, s.points_awarded AS pointsAwarded, s.created_at AS createdAt, c.name AS campaignName FROM campaign_submissions s INNER JOIN campaigns c ON c.id = s.campaign_id INNER JOIN discord_members dm ON dm.id = s.member_id INNER JOIN users u ON u.id = dm.user_id WHERE s.guild_id = ? AND u.discord_id = ?" + filter + " ORDER BY s.created_at DESC LIMIT 20",
    params,
  );
  return rows.map((row) => ({ ...row, pointsAwarded: Number(row.pointsAwarded || 0), campaign: { name: row.campaignName } }));
}

export async function listApprovedSubmissions(guildId, campaignId = null, limit = 12) {
  const params = [guildId];
  let filter = "";
  if (campaignId) { filter = " AND s.campaign_id = ?"; params.push(campaignId); }
  params.push(Math.min(30, Math.max(1, Number(limit) || 12)));
  const [rows] = await getPool().execute(
    "SELECT s.id, s.content, s.category, s.link_url AS linkUrl, s.created_at AS createdAt, c.name AS campaignName, u.username FROM campaign_submissions s INNER JOIN campaigns c ON c.id = s.campaign_id INNER JOIN discord_members dm ON dm.id = s.member_id INNER JOIN users u ON u.id = dm.user_id WHERE s.guild_id = ? AND s.status = 'APPROVED'" + filter + " ORDER BY s.created_at DESC LIMIT ?",
    params,
  );
  return rows;
}

export async function createCampaign(guildId, input, actorId) {
  const name = String(input.name || "").trim().slice(0, 190);
  const description = String(input.description || "").trim();
  const startsAt = new Date(input.startsAt);
  const endsAt = new Date(input.endsAt);
  const pointReward = input.pointReward ?? 0;
  const status = String(input.status || "DRAFT").toUpperCase();
  const allowed = new Set(["DRAFT", "ACTIVE", "ENDED", "CANCELLED"]);
  if (!name || !description || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    throw Object.assign(new Error("Campaign name, description, and valid start/end dates are required"), { status: 400 });
  }
  if (!Number.isSafeInteger(pointReward) || pointReward < 0 || pointReward > 1000000) throw Object.assign(new Error("Invalid campaign point reward"), { status: 400 });
  if (!allowed.has(status)) throw Object.assign(new Error("Invalid campaign status"), { status: 400 });
  const id = crypto.randomUUID();
  await getPool().execute(
    "INSERT INTO campaigns (id, guild_id, name, description, objectives, starts_at, ends_at, tasks, point_reward, submission_requirements, status, created_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    [id, guildId, name, description, input.objectives ? String(input.objectives) : null, startsAt, endsAt, JSON.stringify(Array.isArray(input.tasks) ? input.tasks : []), pointReward, input.submissionRequirements ? String(input.submissionRequirements) : null, status, actorId || null],
  );
  return getCampaign(guildId, id);
}

export async function submitCampaignWork(guildId, user, input) {
  const category = String(input.category || "");
  if (!CAMPAIGN_CATEGORIES.includes(category)) throw Object.assign(new Error("Unsupported submission category"), { status: 400 });
  let url;
  try { url = new URL(String(input.linkUrl || "")); } catch { throw Object.assign(new Error("Submission link must be a valid HTTPS URL"), { status: 400 }); }
  if (url.protocol !== "https:") throw Object.assign(new Error("Submission link must use HTTPS"), { status: 400 });
  const content = String(input.content || "").trim();
  if (!content) throw Object.assign(new Error("Submission description is required"), { status: 400 });
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const member = await resolveMember(connection, guildId, user);
    const [campaigns] = await connection.execute(
      "SELECT id, status, starts_at AS startsAt, ends_at AS endsAt FROM campaigns WHERE guild_id = ? AND id = ? FOR UPDATE",
      [guildId, String(input.campaignId)],
    );
    const campaign = campaigns[0];
    const now = Date.now();
    if (!campaign || campaign.status !== "ACTIVE" || new Date(campaign.startsAt).getTime() > now || new Date(campaign.endsAt).getTime() <= now) {
      throw Object.assign(new Error("That campaign is not accepting submissions."), { status: 409 });
    }
    const id = crypto.randomUUID();
    await connection.execute(
      "INSERT INTO campaign_submissions (id, guild_id, campaign_id, member_id, content, category, link_url, image_url, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'PENDING')",
      [id, guildId, campaign.id, member.id, content, category, url.toString(), input.imageUrl ? String(input.imageUrl) : null],
    );
    await connection.commit();
    return { id, campaignId: campaign.id, memberId: member.discordId, username: member.username, category, content, linkUrl: url.toString(), status: "PENDING" };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function reviewCampaignSubmission(guildId, submissionId, approved, actorId, feedback = "", pointsOverride) {
  const connection = await getPool().getConnection();
  try {
    await connection.beginTransaction();
    const [rows] = await connection.execute(
      "SELECT s.id, s.member_id AS memberId, s.status, s.category, s.campaign_id AS campaignId, c.name AS campaignName, c.point_reward AS pointReward, u.discord_id AS discordId, u.username FROM campaign_submissions s INNER JOIN campaigns c ON c.id = s.campaign_id INNER JOIN discord_members dm ON dm.id = s.member_id INNER JOIN users u ON u.id = dm.user_id WHERE s.guild_id = ? AND s.id = ? FOR UPDATE",
      [guildId, submissionId],
    );
    const submission = rows[0];
    if (!submission) throw Object.assign(new Error("Submission not found"), { status: 404 });
    if (submission.status !== "PENDING") throw Object.assign(new Error("Submission already reviewed"), { status: 409 });
    const points = approved ? (pointsOverride ?? Number(submission.pointReward || 0)) : 0;
    if (!Number.isSafeInteger(points) || points < 0 || points > 1000000) throw Object.assign(new Error("Invalid award amount"), { status: 400 });
    await connection.execute(
      "UPDATE campaign_submissions SET status = ?, feedback = ?, points_awarded = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP(3) WHERE guild_id = ? AND id = ? AND status = 'PENDING'",
      [approved ? "APPROVED" : "REJECTED", feedback ? String(feedback).slice(0, 2000) : null, points, actorId || null, guildId, submissionId],
    );
    if (approved && points > 0) {
      const bucket = SOCIAL.has(submission.category) ? "social" : CONTRIBUTION.has(submission.category) ? "contribution" : "community";
      const balanceColumn = bucket === "social" ? "social_points" : bucket === "contribution" ? "contribution_points" : "community_points";
      await connection.execute(
        "UPDATE point_balances SET overpoints = overpoints + ?, " + balanceColumn + " = " + balanceColumn + " + ?, updated_at = CURRENT_TIMESTAMP(3) WHERE member_id = ?",
        [points, points, submission.memberId],
      );
      const [balances] = await connection.execute("SELECT overpoints FROM point_balances WHERE member_id = ? LIMIT 1", [submission.memberId]);
      await connection.execute(
        "INSERT IGNORE INTO point_transactions (id, guild_id, member_id, currency, category, amount, balance_after, source, idempotency_key, reason, actor_id) VALUES (?, ?, ?, 'OVERPOINTS', ?, ?, ?, 'SOCIAL_SUBMISSION', ?, ?, ?)",
        [crypto.randomUUID(), guildId, submission.memberId, bucket, points, Number(balances[0].overpoints), "campaign-" + submission.id, "Campaign submission approved: " + submission.campaignName, actorId || null],
      );
    }
    await connection.commit();
    return { id: submission.id, campaignId: submission.campaignId, memberId: submission.discordId, username: submission.username, status: approved ? "APPROVED" : "REJECTED", pointsAwarded: points, category: submission.category };
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
