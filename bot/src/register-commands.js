import "dotenv/config";import {REST,Routes} from "discord.js";import {loadCommands} from "./commands/loader.js";
const token=process.env.DISCORD_TOKEN,guildId=process.env.DISCORD_GUILD_ID||null;
if(!token){console.error("DISCORD_TOKEN is missing.");process.exit(1);}
const rest=new REST({version:"10"}).setToken(token);
try{
 const app=process.env.DISCORD_CLIENT_ID|| (await rest.get(Routes.oauth2CurrentApplication())).id;
 const commands=await loadCommands(),body=[...commands.values()].map(x=>x.data.toJSON());
 const route=guildId?Routes.applicationGuildCommands(app,guildId):Routes.applicationCommands(app);
 const result=await rest.put(route,{body});
 console.log("Registered "+result.length+" commands for application "+app+(guildId?" in guild "+guildId:" globally")+".");
}catch(e){console.error("Command registration failed:",{status:e.status,code:e.code,message:e.message});console.error("Check DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID, bot invite scopes (bot + applications.commands), and guild access.");process.exit(1);}
