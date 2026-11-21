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
CREATE UNIQUE INDEX "reward_claims_one_pending_per_member_reward"
  ON "reward_claims"("memberId", "rewardId")
  WHERE "status" = 'PENDING';
