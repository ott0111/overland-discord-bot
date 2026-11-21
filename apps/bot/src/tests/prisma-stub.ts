/**
 * Prisma Client stub, used ONLY by Vitest.
 *
 * vitest.config.ts aliases "@prisma/client" to this file so unit tests can
 * run with no generated Prisma Client and no live database. Importing the
 * real @prisma/client package is safe, but constructing it throws
 * "@prisma/client did not initialize yet" until `prisma generate` has run
 * (which needs network access to the Prisma engine binaries). This stub
 * has the same constructor shape and the same model delegates, each
 * returning harmless null/empty results, so code that merely imports the
 * database layer (for its pure helpers) can be tested.
 *
 * This file is never imported by production code and must never be used
 * outside tests: it stores nothing and talks to no database.
 */

type AsyncFn = (...args: unknown[]) => Promise<unknown>;

function mockModel(): Record<string, AsyncFn> {
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(_target, prop) {
      if (prop === "then") return undefined;
      if (prop === "count") return (async () => 0) as AsyncFn;
      if (prop === "findMany") return (async () => []) as AsyncFn;
      return (async () => null) as AsyncFn;
    },
  };
  return new Proxy({}, handler) as Record<string, AsyncFn>;
}

const MODEL_NAMES = [
  "user",
  "discordMember",
  "role",
  "memberRole",
  "roleHistory",
  "permissionGroup",
  "permission",
  "internalTeamMember",
  "pointBalance",
  "pointTransaction",
  "campaign",
  "campaignSubmission",
  "referral",
  "reward",
  "rewardClaim",
  "achievement",
  "memberAchievement",
  "dailyCheckin",
  "leaderboardSnapshot",
  "ticket",
  "ticketMessage",
  "moderationAction",
  "xPost",
  "botConfiguration",
  "auditLog",
] as const;

/** Stand-in for PrismaClient. Constructor never throws and never connects. */
export class PrismaClient {
  $transaction: (fnOrList: unknown) => Promise<unknown>;
  $disconnect: () => Promise<void>;
  $connect: () => Promise<void>;

  constructor(..._args: unknown[]) {
    for (const name of MODEL_NAMES) {
      (this as unknown as Record<string, unknown>)[name] = mockModel();
    }
    this.$transaction = async (fnOrList: unknown) => {
      if (typeof fnOrList === "function") {
        return (fnOrList as (tx: unknown) => Promise<unknown>)(this);
      }
      if (Array.isArray(fnOrList)) return Promise.all(fnOrList);
      return fnOrList;
    };
    this.$disconnect = async () => undefined;
    this.$connect = async () => undefined;
  }
}

export default PrismaClient;
