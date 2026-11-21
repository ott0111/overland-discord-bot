import { PrismaClient } from "@prisma/client";
import type { PrismaClient as PrismaClientType } from "@prisma/client";

/**
 * Lazy Prisma client.
 *
 * Importing this module must never construct a PrismaClient: construction
 * throws "@prisma/client did not initialize yet" when `prisma generate`
 * has not run (for example in unit tests, or on a fresh checkout before
 * the database is set up), and it also requires DATABASE_URL. The client
 * is therefore created on first use, behind a Proxy, and only then does a
 * missing generated client produce a clear error telling the operator to
 * run `npx prisma generate --schema prisma/schema.prisma`.
 *
 * In tests, vitest.config.ts aliases "@prisma/client" to the stub in
 * src/tests/prisma-stub.ts, so first use there gets the stub, never the
 * real (ungenerated) client and never a live database.
 */
let client: PrismaClientType | null = null;

function loadClient(): PrismaClientType {
  if (client) return client;
  try {
    client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  } catch (err) {
    throw new Error(
      "Prisma Client is not available. Run `npx prisma generate --schema prisma/schema.prisma` " +
        "with network access to the Prisma engine binaries, then retry. " +
        `Underlying error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return client;
}

export const prisma: PrismaClientType = new Proxy({} as PrismaClientType, {
  get(_target, prop) {
    const target = loadClient() as unknown as Record<string | symbol, unknown>;
    const value = target[prop];
    // Bind methods ($transaction, $disconnect, model delegates) so `this`
    // inside the real client still points at the client instance.
    return typeof value === "function"
      ? (value as (...args: unknown[]) => unknown).bind(target)
      : value;
  },
  set(_target, prop, value) {
    (loadClient() as unknown as Record<string | symbol, unknown>)[prop] = value;
    return true;
  },
  has(_target, prop) {
    return prop in loadClient();
  },
});

/** Test-only reset so a fresh client is built on next use. */
export function __resetPrismaClientForTests(): void {
  client = null;
}

/**
 * Best-effort audit write. Audit logging must never break the caller, so
 * any failure (including an unavailable Prisma Client) is swallowed.
 */
export async function audit(
  actorId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: { actorId, action, entityType, entityId, details: details as never },
    });
  } catch {
    // Audit is best effort by design.
  }
}
