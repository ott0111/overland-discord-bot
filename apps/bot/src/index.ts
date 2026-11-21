
import { Client, GatewayIntentBits, Events } from "discord.js";
import { loadEnv } from "./config/env.js";
import { logger, logError } from "./lib/logger.js";
import { prisma } from "./lib/db.js";
import { overlandEmbed, errorEmbed } from "./lib/embeds.js";
import { claimReward } from "./modules/rewards/service.js";
import { commands } from "./commands/index.js";
import { registerEvents } from "./events/index.js";
import { registerJobs, scheduleRecurring } from "./jobs/index.js";
import { startWorkers, closeWorkers } from "./lib/queue.js";
async function main(): Promise<void> {
  let env;
  try { env = loadEnv(); } catch (err) { logger.fatal({ err: err instanceof Error ? err.message : err }, "Overland Core cannot start: missing environment configuration. See .env.example."); process.exit(1); }
  const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent, GatewayIntentBits.GuildInvites] });
  const commandMap = new Map(commands.map((c) => [c.data.name, c]));
  client.on(Events.InteractionCreate, async (interaction) => {
    if (interaction.isButton() && interaction.customId.startsWith("overland:reward:claim:")) {
      await interaction.deferReply({ ephemeral: true });
      try {
        const user = await prisma.user.upsert({
          where: { discordId: interaction.user.id },
          update: { username: interaction.user.username },
          create: { discordId: interaction.user.id, username: interaction.user.username },
        });
        const member = await prisma.discordMember.upsert({
          where: { userId: user.id },
          update: {},
          create: { userId: user.id, guildId: interaction.guildId ?? "" },
        });
        const rewardId = interaction.customId.slice("overland:reward:claim:".length);
        const result = await claimReward(member.id, rewardId);
        if (result.duplicate) {
          await interaction.editReply({
            embeds: [overlandEmbed("Claim already active", "You already have an active claim for this reward. Staff will review it.")],
          });
        } else {
          await interaction.editReply({
            embeds: [overlandEmbed("Reward claimed", "Your claim is pending staff approval. Remaining Overcredits: " + (result.balance?.overcredits ?? "unknown") + ".")],
          });
        }
      } catch (err) {
        await interaction.editReply({
          embeds: [errorEmbed(err instanceof Error ? err.message : "Reward claim failed.")],
        }).catch(() => undefined);
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const cmd = commandMap.get(interaction.commandName);
    if (!cmd) return;
    try { await cmd.execute(interaction); } catch (err) { logError(`command:${interaction.commandName}`, err); if (interaction.deferred || interaction.replied) await interaction.editReply("Something went wrong. Staff have been notified.").catch(() => undefined); else await interaction.reply({ content: "Something went wrong. Staff have been notified.", ephemeral: true }).catch(() => undefined); }
  });
  registerEvents(client);
  registerJobs(client);
  await startWorkers().catch((err) => logger.warn({ err }, "Redis workers unavailable; queue will use in-memory fallback"));
  await client.login(env.DISCORD_TOKEN);
  await scheduleRecurring();
  logger.info("Overland Core is running. Gateway connected.");
  const shutdown = async (signal: string) => { logger.info(`Received ${signal}, shutting down gracefully`); await closeWorkers(); await prisma.$disconnect(); client.destroy(); process.exit(0); };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
main().catch((err) => { logError("startup", err); process.exit(1); });
