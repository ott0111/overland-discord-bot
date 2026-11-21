import { logger } from "./logger.js";

export type JobHandler = (payload: Record<string, unknown>) => Promise<void>;
const handlers = new Map<string, JobHandler>();
const seen = new Set<string>();
const workers: Array<{ close: () => Promise<void> }> = [];

export function registerJob(name: string, handler: JobHandler): void {
  handlers.set(name, handler);
}

/** Start durable BullMQ consumers for every registered job type. */
export async function startWorkers(): Promise<void> {
  if (!process.env.REDIS_URL || workers.length) return;
  const [{ Worker }, { default: IORedis }] = await Promise.all([import("bullmq"), import("ioredis")]);
  const Redis = IORedis as unknown as new (...args: any[]) => any;
  const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
  for (const [name, handler] of handlers) {
    const worker = new Worker(name, async (job) => {
      await handler((job.data ?? {}) as Record<string, unknown>);
    }, { connection });
    worker.on("failed", (job, err) => logger.error({ jobId: job?.id, name, err }, "Queue job failed"));
    worker.on("error", (err) => logger.error({ name, err }, "Queue worker error"));
    workers.push(worker);
  }
  logger.info({ workers: workers.length }, "BullMQ workers started");
}

/** Enqueue idempotently. Redis is durable; without Redis, use a local timer fallback. */
export async function enqueue(
  name: string,
  payload: Record<string, unknown>,
  idempotencyKey: string,
  delayMs = 0,
): Promise<boolean> {
  const handler = handlers.get(name);
  if (!handler) {
    logger.warn({ name }, "No job handler registered");
    return false;
  }
  if (seen.has(idempotencyKey)) {
    logger.info({ name, idempotencyKey }, "Duplicate job skipped");
    return false;
  }
  if (process.env.REDIS_URL) {
    try {
      const [{ Queue }, { default: IORedis }] = await Promise.all([import("bullmq"), import("ioredis")]);
      const Redis = IORedis as unknown as new (...args: any[]) => any;
      const connection = new Redis(process.env.REDIS_URL, { maxRetriesPerRequest: null });
      const queue = new Queue(name, { connection });
      await queue.add(name, payload, { jobId: idempotencyKey, delay: delayMs, attempts: 5, backoff: { type: "exponential", delay: 30000 }, removeOnComplete: 1000, removeOnFail: 5000 });
      await queue.close();
      await connection.quit();
      seen.add(idempotencyKey);
      return true;
    } catch (err) {
      logger.warn({ err, name }, "Redis enqueue failed; using in-memory fallback");
    }
  }
  seen.add(idempotencyKey);
  const runFallback = async (attempt = 1): Promise<void> => {
    try {
      await handler(payload);
    } catch (err) {
      if (attempt < 5) {
        const retryDelay = Math.min(60000, 1000 * 2 ** attempt);
        logger.warn({ err, name, attempt, retryDelay }, "In-memory job failed; retrying");
        setTimeout(() => { runFallback(attempt + 1).catch(() => undefined); }, retryDelay);
      } else {
        logger.error({ err, name }, "In-memory job exhausted retries");
      }
    }
  };
  setTimeout(() => { runFallback().catch(() => undefined); }, delayMs);
  return true;
}

export async function closeWorkers(): Promise<void> {
  await Promise.all(workers.splice(0).map((worker) => worker.close().catch(() => undefined)));
}
