import "dotenv/config";
import { REST, Routes } from "discord.js";
import { loadCommands } from "./commands/loader.js";
const token = process.env.DISCORD_TOKEN, configuredAppId = process.env.DISCORD_CLIENT_ID, guildId = process.env.DISCORD_GUILD_ID || null;
if (!token) { console.error("[Commands] DISCORD_TOKEN is missing."); process.exit(1); }
const rest = new REST({ version: "10" }).setToken(token);
try {
  const application = await rest.get(Routes.oauth2CurrentApplication()), appId = application.id;
  if (configuredAppId && configuredAppId !== appId) throw new Error("DISCORD_CLIENT_ID does not match the application belonging to DISCORD_TOKEN. Copy the Application ID from that same Developer Portal app.");
  if (guildId) await rest.get(Routes.guild(guildId));
  const commands = await loadCommands(), body = [...commands.values()].map(x => x.data.toJSON());
  const route = guildId ? Routes.applicationGuildCommands(appId, guildId) : Routes.applicationCommands(appId);
  const result = await rest.put(route, { body });
  console.log("[Commands] Registered " + result.length + " commands for " + (guildId ? "guild " + guildId : "the global application") + ".");
  if (!guildId) console.warn("[Commands] Global propagation may take up to an hour. Use DISCORD_GUILD_ID while testing.");
} catch (error) {
  console.error("[Commands] Registration failed:", { status: error.status, code: error.code, message: error.message });
  console.error("[Commands] Check DISCORD_TOKEN, matching DISCORD_CLIENT_ID, DISCORD_GUILD_ID, and invite scopes bot + applications.commands.");
  process.exit(1);
}
