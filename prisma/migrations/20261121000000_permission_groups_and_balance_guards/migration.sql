-- Allow the same granular permission to be granted to multiple groups.
DROP INDEX IF EXISTS "permissions_key_key";
CREATE UNIQUE INDEX "permissions_key_groupId_key" ON "permissions"("key", "groupId");
CREATE INDEX "permissions_key_idx" ON "permissions"("key");

-- Keep all currency and category balances non-negative at the database boundary.
ALTER TABLE "point_balances"
  ADD CONSTRAINT "point_balances_nonnegative_check"
  CHECK (
    "overpoints" >= 0 AND
    "overcredits" >= 0 AND
    "communityPoints" >= 0 AND
    "socialPoints" >= 0 AND
    "referralPoints" >= 0 AND
    "contributionPoints" >= 0
  );


-- Prevent a member from holding two pending claims for the same reward.
-- The constraint is partial because completed/rejected claims remain as history.
DROP INDEX IF EXISTS "reward_claims_one_pending_per_member_reward";
CREATE UNIQUE INDEX "reward_claims_one_active_per_member_reward"
  ON "reward_claims"("memberId", "rewardId")
  WHERE "status" IN ('PENDING', 'APPROVED');


-- Persist bot-created invite codes against the member who owns each link.
CREATE TABLE "referral_invites" (
  "id" TEXT NOT NULL,
  "memberId" TEXT NOT NULL,
  "inviteCode" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "referral_invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "referral_invites_inviteCode_key" ON "referral_invites"("inviteCode");
CREATE INDEX "referral_invites_memberId_revokedAt_idx" ON "referral_invites"("memberId", "revokedAt");
ALTER TABLE "referral_invites"
  ADD CONSTRAINT "referral_invites_memberId_fkey"
  FOREIGN KEY ("memberId") REFERENCES "discord_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Track what kind of work each campaign submission represents.
ALTER TABLE "campaign_submissions"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'social';


-- Prevent duplicate leaderboard rows when scheduled snapshots are retried.
CREATE UNIQUE INDEX "leaderboard_snapshots_period_category_periodKey_memberId_key"
  ON "leaderboard_snapshots"("period", "category", "periodKey", "memberId");
