
import { REST, Routes } from "discord.js";
import { commands } from "./commands/index.js";
import { loadEnv } from "./config/env.js";
const env = loadEnv();
const rest = new REST({ version: "10" }).setToken(env.DISCORD_TOKEN);
const body = commands.map((c) => c.data.toJSON());
await rest.put(Routes.applicationGuildCommands(env.DISCORD_CLIENT_ID, env.DISCORD_GUILD_ID), { body });
console.log(`Registered ${body.length} guild commands.`);
