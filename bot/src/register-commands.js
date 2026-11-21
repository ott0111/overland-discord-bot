import "dotenv/config";
import { REST, Routes } from "discord.js";
import { commands } from "./commands.js";

const token = process.env.DISCORD_TOKEN;
const clientId = process.env.DISCORD_CLIENT_ID;
const guildId = process.env.DISCORD_GUILD_ID;

if (!token || !clientId) {
  console.error("Missing DISCORD_TOKEN or DISCORD_CLIENT_ID in bot/.env");
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(token);

try {
  const route = guildId
    ? Routes.applicationGuildCommands(clientId, guildId)
    : Routes.applicationCommands(clientId);

  await rest.put(route, { body: commands });
  console.log("Registered " + commands.length + " Overland slash commands.");
  if (!guildId) console.log("Global commands can take time to appear. Set DISCORD_GUILD_ID for instant test-server updates.");
} catch (error) {
  console.error("Command registration failed:", error.message);
  process.exit(1);
}
