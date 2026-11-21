
import { logger } from "./logger.js";
export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, JobHandler>();
const seen = new Set<string>();
export function registerJob(name: string, handler: JobHandler): void { handlers.set(name, handler); }
/** Duplicate-job prevention via idempotency key. Falls back to in-memory timers when Redis is absent. */
export async function enqueue(name: string, payload: Record<string, unknown>, idempotencyKey: string, delayMs = 0): Promise<boolean> {
  if (seen.has(idempotencyKey)) { logger.info({ name, idempotencyKey }, "Duplicate job skipped"); return false; }
  seen.add(idempotencyKey);
  const handler = handlers.get(name);
  if (!handler) { logger.warn({ name }, "No job handler registered"); return false; }
  if (process.env.REDIS_URL) {
    try { const { Queue } = await import("bullmq"); const { default: IORedis } = await import("ioredis");
      const conn = new (IORedis as unknown as new (...args: unknown[]) => any)(process.env.REDIS_URL, { maxRetriesPerRequest: null });
      const q = new Queue(name, { connection: conn });
      await q.add(name, payload, { jobId: idempotencyKey, delay: delayMs }); await q.close(); await conn.quit();
      return true;
    } catch (err) { logger.warn({ err }, "Redis queue failed, falling back to in-memory"); }
  }
  setTimeout(() => { handler(payload).catch((e) => logger.error({ err: e, name }, "Job failed")); }, delayMs);
  return true;
}
