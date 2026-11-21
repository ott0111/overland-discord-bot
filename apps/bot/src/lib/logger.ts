
import pino from "pino";
export const logger = pino({ level: process.env.LOG_LEVEL ?? "info", transport: process.env.NODE_ENV === "development" ? { target: "pino-pretty", options: { colorize: true } } : undefined });
export function logError(context: string, err: unknown): void { logger.error({ context, err: err instanceof Error ? { message: err.message, stack: err.stack } : err }); }
