import { getGuild, getMember, saveStore } from "../store.js";
import { award } from "./economy.js";
import {
  listActiveCampaigns, getCampaign, listMemberSubmissions, listApprovedSubmissions,
  createCampaign as createCampaignNormalized, submitCampaignWork, reviewCampaignSubmission,
} from "../db/repositories/campaigns.js";

export const CATEGORIES = ["social_post", "infographic", "educational_thread", "article", "campaign_contribution", "video", "graphic_design", "industry_research", "contribution_article", "product_feedback", "community_initiative", "significant_contribution"];

export async function activeCampaigns(guildId) {
  if (process.env.OVERLAND_STORAGE === "mysql") return listActiveCampaigns(guildId);
  return getGuild(guildId).campaigns.filter((campaign) => campaign.status === "ACTIVE" && new Date(campaign.endsAt) > new Date());
}
export async function createCampaign(guildId, data, actorId) {
  if (process.env.OVERLAND_STORAGE === "mysql") return createCampaignNormalized(guildId, { ...data, status: data.status || "ACTIVE" }, actorId);
  const guild = getGuild(guildId);
  const campaign = { id: crypto.randomUUID(), ...data, status: "ACTIVE", createdBy: actorId, createdAt: new Date().toISOString() };
  guild.campaigns.unshift(campaign);
  await saveStore();
  return campaign;
}
export async function submitWork(guildId, user, data) {
  if (process.env.OVERLAND_STORAGE === "mysql") return submitCampaignWork(guildId, user, data);
  const guild = getGuild(guildId), member = getMember(guildId, user), campaign = guild.campaigns.find((item) => item.id === data.campaignId && item.status === "ACTIVE");
  if (!campaign || new Date(campaign.endsAt) < new Date()) throw new Error("That campaign is not accepting submissions.");
  if (!/^https:\/\//i.test(data.linkUrl)) throw new Error("Submission link must use HTTPS.");
  const submission = { id: crypto.randomUUID(), campaignId: campaign.id, memberId: member.id, username: member.username, category: data.category, content: data.content, linkUrl: data.linkUrl, imageUrl: data.imageUrl || null, status: "PENDING", createdAt: new Date().toISOString(), feedback: null, pointsAwarded: 0 };
  guild.submissions.unshift(submission);
  await saveStore();
  return submission;
}
export async function reviewSubmission(guildId, submissionId, approved, actorId, feedback = "", pointsOverride) {
  if (process.env.OVERLAND_STORAGE === "mysql") return reviewCampaignSubmission(guildId, submissionId, approved, actorId, feedback, pointsOverride);
  const guild = getGuild(guildId), submission = guild.submissions.find((item) => item.id === submissionId);
  if (!submission) throw new Error("Submission not found.");
  if (submission.status !== "PENDING") throw new Error("Submission has already been reviewed.");
  if (approved) {
    const campaign = guild.campaigns.find((item) => item.id === submission.campaignId);
    const amount = Math.max(0, Math.min(100, campaign?.pointReward || guild.settings.pointValues[submission.category] || 0));
    const social = ["social_post", "infographic", "video", "graphic_design"].includes(submission.category);
    const research = ["industry_research", "article", "educational_thread", "contribution_article"].includes(submission.category);
    if (amount) await award(guildId, submission.memberId, { amount, currency: "OVERPOINTS", category: social ? "social" : research ? "contribution" : "community", source: "SOCIAL_SUBMISSION", reason: "Approved campaign submission", actorId, idempotencyKey: "submission:" + submission.id });
    submission.pointsAwarded = amount;
  }
  submission.status = approved ? "APPROVED" : "REJECTED";
  submission.reviewedBy = actorId;
  submission.reviewedAt = new Date().toISOString();
  submission.feedback = feedback;
  await saveStore();
  return submission;
}
export async function campaignDetails(guildId, campaignId) {
  if (process.env.OVERLAND_STORAGE === "mysql") return getCampaign(guildId, campaignId);
  return getGuild(guildId).campaigns.find((campaign) => campaign.id === campaignId) || null;
}
export async function mySubmissions(guildId, discordId) {
  if (process.env.OVERLAND_STORAGE === "mysql") return listMemberSubmissions(guildId, discordId);
  return getGuild(guildId).submissions.filter((submission) => submission.memberId === discordId).slice(0, 12);
}
export async function campaignGallery(guildId, campaignId = null) {
  if (process.env.OVERLAND_STORAGE === "mysql") return listApprovedSubmissions(guildId, campaignId, 12);
  return getGuild(guildId).submissions.filter((submission) => submission.status === "APPROVED" && (!campaignId || submission.campaignId === campaignId)).slice(0, 12);
}
