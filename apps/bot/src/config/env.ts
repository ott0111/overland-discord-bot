
import { z } from "zod";
const schema = z.object({
  DISCORD_TOKEN: z.string().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().min(1),
  DISCORD_CLIENT_SECRET: z.string().optional().default(""),
  DISCORD_GUILD_ID: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().optional(),
  X_BEARER_TOKEN: z.string().optional().default(""),
  X_USERNAME: z.string().default("OverlandFinance"),
  LOG_LEVEL: z.string().default("info"),
  NODE_ENV: z.string().default("development"),
});
export type Env = z.infer<typeof schema>;
export function loadEnv(): Env {
  const parsed = schema.safeParse(process.env);
  if (!parsed.success) {
    const missing = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
    throw new Error(`Missing or invalid environment configuration: ${missing}. See .env.example.`);
  }
  return parsed.data;
}
