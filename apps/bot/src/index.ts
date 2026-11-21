
import { Client, GatewayIntentBits, Events } from "discord.js";
import { loadEnv } from "./config/env.js";
import { logger, logError } from "./lib/logger.js";
import { prisma } from "./lib/db.js";
import { commands } from "./commands/index.js";
import { registerEvents } from "./events/index.js";
import { registerJobs, scheduleRecurring } from "./jobs/index.js";
async function main(): Promise<void> {
  let env;
  try { env = loadEnv(); } catch (err) { logger.fatal({ err: err instanceof Error ? err.message : err }, "Overland Core cannot start: missing environment configuration. See .env.example."); process.exit(1); }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildInvites] });
  const commandMap = new Map(commands.map((c) => [c.data.name, c]));
  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;
    try { await cmd.execute(interaction); } catch (err) { logError(`command:${interaction.commandName}`, err); if (interaction.deferred || interaction.replied) await interaction.editReply("Something went wrong. Staff have been notified.").catch(() => undefined); else await interaction.reply({ content: "Something went wrong. Staff have been notified.", ephemeral: true }).catch(() => undefined); }
  });
  registerEvents(client);
  registerJobs();
  await client.login(env.DISCORD_TOKEN);
  await scheduleRecurring();
  logger.info("Overland Core is running. Gateway connected.");
  const shutdown = async (signal: string) => { logger.info(`Received ${signal}, shutting down gracefully`); await prisma.$disconnect(); client.destroy(); process.exit(0); };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
main().catch((err) => { logError("startup", err); process.exit(1); });
