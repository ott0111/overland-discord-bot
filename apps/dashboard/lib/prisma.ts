import { PrismaClient } from "@prisma/client";
// Lazy client: the PrismaClient constructor is only called on first use, so
// importing this module never opens a connection or throws when the database
// is not configured. In this VM the generated client is absent (prisma
// generate cannot download its engine), so keep the proxy typed as
// PrismaClient and bind methods to the real instance.
let client: PrismaClient | null = null;
export function getPrisma(): PrismaClient {
  if (!client) {
    client = new PrismaClient({
      log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    });
  }
  return client;
}
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, prop) {
    const value = (getPrisma() as unknown as Record<string | symbol, unknown>)[prop];
    if (typeof value === "function") {
      return (value as (...args: unknown[]) => unknown).bind(getPrisma());
    }
    return value;
  },
});
