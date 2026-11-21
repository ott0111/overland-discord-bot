import { prisma, audit } from "../../lib/db.js";
import { awardPoints } from "../../lib/points.js";
import { getPointValues } from "../../lib/config.js";
import { hasPermission } from "../../lib/permissions.js";
import { checkAndGrant } from "../achievements/service.js";
import { logger } from "../../lib/logger.js";

export interface CreateCampaignInput {
  name: string;
  description: string;
  objectives?: string;
  startsAt: Date;
  endsAt: Date;
  tasks?: unknown;
  pointReward: number;
  submissionRequirements?: string;
}

export interface SubmitWorkInput {
  content: string;
  linkUrl?: string | null;
  imageUrl?: string | null;
}

function assertCampaignWindow(input: CreateCampaignInput): void {
  if (!input.name.trim()) throw new Error("Campaign name is required");
  if (input.pointReward < 0) throw new Error("Point reward must not be negative");
  if (input.endsAt <= input.startsAt) throw new Error("Campaign end date must be after its start date");
}

/** Staff only. Creates a campaign in DRAFT; staff activate it from the dashboard. */
export async function createCampaign(staffDiscordId: string, input: CreateCampaignInput) {
  if (!(await hasPermission(staffDiscordId, "campaigns.manage"))) {
    throw new Error("You do not have permission to create campaigns");
  }
  assertCampaignWindow(input);
  const campaign = await prisma.campaign.create({
    data: {
      name: input.name.trim(),
      description: input.description,
      objectives: input.objectives,
      startsAt: input.startsAt,
      endsAt: input.endsAt,
      tasks: (input.tasks ?? null) as never,
      pointReward: input.pointReward,
      submissionRequirements: input.submissionRequirements,
      status: "DRAFT",
      createdBy: staffDiscordId,
    },
  });
  await audit(staffDiscordId, "campaigns.create", "Campaign", campaign.id, { name: campaign.name });
  return campaign;
}

/** Activate a draft campaign. Rejects campaigns whose end date already passed. */
export async function activateCampaign(staffDiscordId: string, campaignId: string) {
  if (!(await hasPermission(staffDiscordId, "campaigns.manage"))) {
    throw new Error("You do not have permission to manage campaigns");
  }
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("Campaign not found");
  if (campaign.endsAt <= new Date()) throw new Error("Campaign end date has already passed");
  return prisma.campaign.update({ where: { id: campaignId }, data: { status: "ACTIVE" } });
}

/** Campaigns currently open for submissions, ordered by soonest end date. */
export async function listActive() {
  const now = new Date();
  return prisma.campaign.findMany({
    where: { status: "ACTIVE", startsAt: { lte: now }, endsAt: { gte: now } },
    orderBy: { endsAt: "asc" },
  });
}

export async function getCampaign(campaignId: string) {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: { submissions: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!campaign) throw new Error("Campaign not found");
  return campaign;
}

/** True when the campaign accepts submissions right now. */
export function isCampaignOpen(campaign: { status: string; startsAt: Date; endsAt: Date }, now = new Date()): boolean {
  return campaign.status === "ACTIVE" && campaign.startsAt <= now && campaign.endsAt >= now;
}

function isValidUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Submit work to a campaign. Validates that the campaign is open, that the
 * links are well formed, and that the member does not already have a
 * pending submission for the same campaign (dedupe: the existing pending
 * submission is returned instead of creating a second one).
 */
export async function submitWork(memberId: string, campaignId: string, input: SubmitWorkInput) {
  const campaign = await prisma.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) throw new Error("Campaign not found");
  if (!isCampaignOpen(campaign)) throw new Error("Campaign is not accepting submissions right now");
  if (!input.content.trim()) throw new Error("Submission content is required");
  if (input.content.trim().length > 4000) throw new Error("Submission content is too long (4000 characters max)");
  if (input.linkUrl && !isValidUrl(input.linkUrl)) throw new Error("Submission link is not a valid URL");
  if (input.imageUrl && !isValidUrl(input.imageUrl)) throw new Error("Image link is not a valid URL");
  const existing = await prisma.campaignSubmission.findFirst({
    where: { campaignId, memberId, status: "PENDING" },
  });
  if (existing) return { duplicate: true, submission: existing };
  const submission = await prisma.campaignSubmission.create({
    data: {
      campaignId,
      memberId,
      content: input.content.trim(),
      linkUrl: input.linkUrl ?? null,
      imageUrl: input.imageUrl ?? null,
    },
  });
  await audit(null, "campaigns.submit", "CampaignSubmission", submission.id, { campaignId, memberId });
  return { duplicate: false, submission };
}

/**
 * Staff review of a submission. Approving awards points atomically with
 * the status change in one transaction: the submission update and the
 * point award share the transaction client, and the award uses the
 * idempotency key `campaign-<submissionId>` so a retried review can never
 * pay twice. Rejecting records staff feedback and awards nothing.
 */
export async function reviewSubmission(
  staffDiscordId: string,
  submissionId: string,
  approve: boolean,
  feedback?: string,
  pointsOverride?: number,
) {
  if (!(await hasPermission(staffDiscordId, "campaigns.review"))) {
    throw new Error("You do not have permission to review submissions");
  }
  const submission = await prisma.campaignSubmission.findUnique({
    where: { id: submissionId },
    include: { campaign: true },
  });
  if (!submission) throw new Error("Submission not found");
  if (submission.status !== "PENDING") throw new Error(`Submission was already ${submission.status.toLowerCase()}`);
  if (!approve) {
    const rejected = await prisma.campaignSubmission.update({
      where: { id: submissionId },
      data: { status: "REJECTED", feedback: feedback ?? null, reviewedBy: staffDiscordId, reviewedAt: new Date() },
    });
    await audit(staffDiscordId, "campaigns.review.reject", "CampaignSubmission", submissionId, { feedback });
    return { submission: rejected, awarded: null };
  }
  const values = await getPointValues();
  const fallback = (values.social as unknown as Record<string, number>).campaignContribution ?? submission.campaign.pointReward;
  const amount = pointsOverride ?? submission.campaign.pointReward ?? fallback;
  if (amount < 0) throw new Error("Award amount must not be negative");
  const result = await prisma.$transaction(async (tx: never) => {
    const updated = await (tx as unknown as {
      campaignSubmission: { update: (args: unknown) => Promise<unknown> };
    }).campaignSubmission.update({
      where: { id: submissionId },
      data: {
        status: "APPROVED",
        feedback: feedback ?? null,
        pointsAwarded: amount,
        reviewedBy: staffDiscordId,
        reviewedAt: new Date(),
      },
    });
    let awarded: unknown = null;
    if (amount > 0) {
      awarded = await awardPoints(
        {
          memberId: submission.memberId,
          currency: "OVERPOINTS",
          category: "social",
          amount,
          source: "SOCIAL_SUBMISSION",
          reason: `Approved submission for campaign ${submission.campaign.name}`,
          actorId: staffDiscordId,
          idempotencyKey: `campaign-${submissionId}`,
        },
        tx as never,
      );
    }
    return { submission: updated, awarded };
  });
  await audit(staffDiscordId, "campaigns.review.approve", "CampaignSubmission", submissionId, {
    pointsAwarded: amount,
    feedback,
  });
  try {
    await checkAndGrant(submission.memberId);
  } catch (err) {
    logger.warn({ err }, "Achievement check after campaign approval failed");
  }
  return result;
}

/** Submissions for one campaign, optionally filtered by status. */
export async function listSubmissions(campaignId: string, status?: "PENDING" | "APPROVED" | "REJECTED") {
  return prisma.campaignSubmission.findMany({
    where: { campaignId, ...(status ? { status: status as never } : {}) },
    orderBy: { createdAt: "desc" },
    include: { member: { include: { user: true } } },
  });
}

/** Full submission history for one member, newest first. */
export async function submissionHistory(memberId: string, take = 50) {
  return prisma.campaignSubmission.findMany({
    where: { memberId },
    orderBy: { createdAt: "desc" },
    take,
    include: { campaign: { select: { id: true, name: true, pointReward: true } } },
  });
}

/** Pending submissions across all campaigns, for the staff review queue. */
export async function listPendingReview(take = 50) {
  return prisma.campaignSubmission.findMany({
    where: { status: "PENDING" },
    orderBy: { createdAt: "asc" },
    take,
    include: { campaign: { select: { id: true, name: true } }, member: { include: { user: true } } },
  });
}
