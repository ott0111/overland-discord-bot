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
