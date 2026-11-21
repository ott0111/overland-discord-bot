import { prisma, audit } from "../../lib/db.js";
import { hasPermission } from "../../lib/permissions.js";

export interface ClaimGuard {
  ok: boolean;
  reason?: string;
}

/**
 * Pure reward-claim guard, unit tested without a database. Mirrors the
 * checks inside claimReward: inactive reward, then out of stock, then
 * insufficient Overcredits. A claim is only allowed when all pass.
 */
export function canClaimReward(
  overcredits: number,
  costOvercredits: number,
  stock: number | null,
  active: boolean,
): ClaimGuard {
  if (!active) return { ok: false, reason: "Reward is not available" };
  if (costOvercredits < 0) return { ok: false, reason: "Reward cost must not be negative" };
  if (stock !== null && stock <= 0) return { ok: false, reason: "Reward is out of stock" };
  if (overcredits < costOvercredits) return { ok: false, reason: "Insufficient Overcredits" };
  return { ok: true };
}

/** Available rewards for the /rewards marketplace, cheapest first. */
export async function listRewards(activeOnly = true) {
  return prisma.reward.findMany({
    where: activeOnly ? { active: true } : {},
    orderBy: [{ costOvercredits: "asc" }, { name: "asc" }],
  });
}

export async function getReward(rewardId: string) {
  const reward = await prisma.reward.findUnique({ where: { id: rewardId } });
  if (!reward) throw new Error("Reward not found");
  return reward;
}

export interface CreateRewardInput {
  name: string;
  description: string;
  imageUrl?: string | null;
  costOvercredits: number;
  stock?: number | null;
  eligibility?: string | null;
}

/** Staff only. Creates a reward catalog entry. */
export async function createReward(staffDiscordId: string, input: CreateRewardInput) {
  if (!(await hasPermission(staffDiscordId, "rewards.manage"))) {
    throw new Error("You do not have permission to manage rewards");
  }
  if (!input.name.trim()) throw new Error("Reward name is required");
  if (input.costOvercredits < 0) throw new Error("Reward cost must not be negative");
  if (input.stock !== undefined && input.stock !== null && input.stock < 0) {
    throw new Error("Reward stock must not be negative");
  }
  const reward = await prisma.reward.create({
    data: {
      name: input.name.trim(),
      description: input.description,
      imageUrl: input.imageUrl ?? null,
      costOvercredits: input.costOvercredits,
      stock: input.stock ?? null,
      eligibility: input.eligibility ?? null,
      active: true,
    },
  });
  await audit(staffDiscordId, "rewards.create", "Reward", reward.id, { name: reward.name, cost: reward.costOvercredits });
  return reward;
}

export interface UpdateRewardInput {
  name?: string;
  description?: string;
  imageUrl?: string | null;
  costOvercredits?: number;
  stock?: number | null;
  eligibility?: string | null;
  active?: boolean;
}

/** Staff only. Edit price, stock, eligibility or availability. */
export async function updateReward(staffDiscordId: string, rewardId: string, input: UpdateRewardInput) {
  if (!(await hasPermission(staffDiscordId, "rewards.manage"))) {
    throw new Error("You do not have permission to manage rewards");
  }
  if (input.costOvercredits !== undefined && input.costOvercredits < 0) {
    throw new Error("Reward cost must not be negative");
  }
  const reward = await prisma.reward.update({ where: { id: rewardId }, data: input });
  await audit(staffDiscordId, "rewards.update", "Reward", rewardId, { ...input });
  return reward;
}

/**
 * Atomic claim: inside one transaction the reward is checked (active,
 * in stock), any existing pending claim by the same member for the same
 * reward is returned instead of double spending, the Overcredits debit
 * is recorded as a PointTransaction (never below zero), stock is
 * decremented, and the RewardClaim is created as PENDING for staff
 * review. A concurrent second claim sees the stock/balance change and
 * fails instead of overspending.
 */
export async function claimReward(memberId: string, rewardId: string) {
  const idempotencyKey = `claim-${memberId}-${rewardId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    const result = await prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${memberId}))`;
      const reward = await tx.reward.findUnique({ where: { id: rewardId } });
      if (!reward || !reward.active) throw new Error("Reward is not available");

      const pending = await tx.rewardClaim.findFirst({
        where: { rewardId, memberId, status: { in: ["PENDING", "APPROVED"] } },
      });
      if (pending) return { duplicate: true, claim: pending, balance: null };

      if (reward.costOvercredits < 0) throw new Error("Reward cost must not be negative");

      // Reserve finite stock with a conditional decrement. Concurrent claims
      // cannot take the last item twice.
      if (reward.stock !== null) {
        const stockUpdate = await tx.reward.updateMany({
          where: { id: rewardId, active: true, stock: { gt: 0 } },
          data: { stock: { decrement: 1 } },
        });
        if (stockUpdate.count !== 1) throw new Error("Reward is out of stock");
      }

      // Ensure a balance row exists, including for free rewards.
      await tx.pointBalance.upsert({
        where: { memberId },
        update: {},
        create: { memberId },
      });

      // Debit only if the current balance still covers the cost.
      const debit = await tx.pointBalance.updateMany({
        where: { memberId, overcredits: { gte: reward.costOvercredits } },
        data: { overcredits: { decrement: reward.costOvercredits } },
      });
      if (debit.count !== 1) throw new Error("Insufficient Overcredits");

      const updatedBalance = await tx.pointBalance.findUniqueOrThrow({ where: { memberId } });
      await tx.pointTransaction.create({
        data: {
          memberId,
          currency: "OVERCREDITS",
          category: "reward",
          amount: -reward.costOvercredits,
          balanceAfter: updatedBalance.overcredits,
          source: "REWARD_CLAIM",
          idempotencyKey,
          reason: `Claimed ${reward.name}`,
        },
      });

      const claim = await tx.rewardClaim.create({
        data: { rewardId, memberId, costOvercredits: reward.costOvercredits, idempotencyKey },
      });
      return { duplicate: false, claim, balance: updatedBalance };
    });

    if (!result.duplicate) {
      await audit(null, "rewards.claim", "RewardClaim", result.claim.id, { rewardId, memberId });
    }
    return result;
  } catch (error) {
    // A partial unique index permits only one pending claim per member/reward.
    // If two requests race, the losing transaction rolls back its debit and stock reservation.
    const existing = await prisma.rewardClaim.findFirst({
      where: { rewardId, memberId, status: "PENDING" },
    }).catch(() => null);
    if (existing) return { duplicate: true, claim: existing, balance: null };
    throw error;
  }
}

async function setClaimStatus(
  staffDiscordId: string,
  claimId: string,
  status: "APPROVED" | "REJECTED" | "FULFILLED" | "CANCELLED",
  permission: string,
) {
  if (!(await hasPermission(staffDiscordId, permission))) {
    throw new Error("You do not have permission to review reward claims");
  }
  const claim = await prisma.rewardClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== "PENDING" && status !== "CANCELLED") {
    throw new Error(`Claim was already ${claim.status.toLowerCase()}`);
  }
  const transition = await prisma.rewardClaim.updateMany({
    where: { id: claimId, status: claim.status },
    data: { status: status as never, reviewedBy: staffDiscordId },
  });
  if (transition.count !== 1) throw new Error("Claim status changed. Refresh and try again.");
  const updated = await prisma.rewardClaim.findUniqueOrThrow({ where: { id: claimId } });
  await audit(staffDiscordId, `rewards.claim.${status.toLowerCase()}`, "RewardClaim", claimId, {});
  return updated;
}

/** Staff only. Approve a pending claim so it can be fulfilled. */
export async function approveClaim(staffDiscordId: string, claimId: string) {
  return setClaimStatus(staffDiscordId, claimId, "APPROVED", "rewards.review");
}

/**
 * Staff only. Reject a claim and refund the Overcredits atomically:
 * the refund PointTransaction and the claim status change share one
 * transaction, keyed `refund-<claimId>` so a retried rejection refunds once.
 */
export async function rejectClaim(staffDiscordId: string, claimId: string) {
  if (!(await hasPermission(staffDiscordId, "rewards.review"))) {
    throw new Error("You do not have permission to review reward claims");
  }
  const claim = await prisma.rewardClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== "PENDING" && claim.status !== "APPROVED") {
    throw new Error(`Claim was already ${claim.status.toLowerCase()}`);
  }
  const updated = await prisma.$transaction(async (tx: any) => {
    const transition = await tx.rewardClaim.updateMany({
      where: { id: claimId, status: { in: ["PENDING", "APPROVED"] } },
      data: { status: "REJECTED", reviewedBy: staffDiscordId },
    });
    if (transition.count !== 1) throw new Error("Claim status changed. Refresh and try again.");
    await tx.pointBalance.upsert({
      where: { memberId: claim.memberId },
      update: {},
      create: { memberId: claim.memberId },
    });
    const refunded = await tx.pointBalance.update({
      where: { memberId: claim.memberId },
      data: { overcredits: { increment: claim.costOvercredits } },
    });
    await tx.pointTransaction.create({
      data: {
        memberId: claim.memberId,
        currency: "OVERCREDITS",
        category: "reward",
        amount: claim.costOvercredits,
        balanceAfter: refunded.overcredits,
        source: "REWARD_CLAIM",
        idempotencyKey: `refund-${claimId}`,
        reason: `Refund for rejected claim ${claimId}`,
        actorId: staffDiscordId,
      },
    });
    const reward = await tx.reward.findUnique({ where: { id: claim.rewardId } });
    if (reward && reward.stock !== null) {
      await tx.reward.update({
        where: { id: claim.rewardId },
        data: { stock: { increment: 1 } },
      });
    }
    return tx.rewardClaim.findUniqueOrThrow({ where: { id: claimId } });
  });
  await audit(staffDiscordId, "rewards.claim.rejected", "RewardClaim", claimId, { refunded: claim.costOvercredits });
  return updated;
}

/** Staff only. Mark an approved claim as fulfilled/delivered. */
export async function fulfillClaim(staffDiscordId: string, claimId: string) {
  if (!(await hasPermission(staffDiscordId, "rewards.review"))) {
    throw new Error("You do not have permission to review reward claims");
  }
  const claim = await prisma.rewardClaim.findUnique({ where: { id: claimId } });
  if (!claim) throw new Error("Claim not found");
  if (claim.status !== "APPROVED") throw new Error(`Only approved claims can be fulfilled (current: ${claim.status})`);
  const transition = await prisma.rewardClaim.updateMany({
    where: { id: claimId, status: "APPROVED" },
    data: { status: "FULFILLED", reviewedBy: staffDiscordId },
  });
  if (transition.count !== 1) throw new Error("Claim status changed. Refresh and try again.");
  const updated = await prisma.rewardClaim.findUniqueOrThrow({ where: { id: claimId } });
  await audit(staffDiscordId, "rewards.claim.fulfilled", "RewardClaim", claimId, {});
  return updated;
}

/** Claims for one member, or all claims for staff review. */
export async function listClaims(memberId?: string, status?: string, take = 50) {
  return prisma.rewardClaim.findMany({
    where: { ...(memberId ? { memberId } : {}), ...(status ? { status: status as never } : {}) },
    orderBy: { createdAt: "desc" },
    take,
    include: { reward: true, member: { include: { user: true } } },
  });
}
