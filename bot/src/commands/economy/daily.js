import {SlashCommandBuilder} from "discord.js";
import {command,reply} from "../helpers.js";
import {dailyCheckin} from "../../services/economy.js";
import {checkProgression,syncDiscordRole} from "../../services/roles.js";
import {checkAchievements} from "../../services/achievements.js";
import {getGuild} from "../../store.js";
export default command(new SlashCommandBuilder().setName("daily").setDescription("Claim daily points and streak bonus"),async i=>{
 const r=await dailyCheckin(i.guildId,i.user);
 let roles=[],ach=[];
 if(process.env.OVERLAND_STORAGE!=="mysql"){
  roles=await checkProgression(i.guildId,i.user);ach=await checkAchievements(i.guildId,i.user);
  for(const role of roles)await syncDiscordRole(getGuild(i.guildId),await i.guild.members.fetch(i.user.id),role,true).catch(()=>{});
 }
 await reply(i,"Daily check-in","+"+r.points+" Overpoints • +"+r.bonus+" Overcredits\nStreak: "+r.streak+" days"+(roles.length?"\nRoles: "+roles.join(", "):"")+(ach.length?"\nAchievements: "+ach.join(", "):""));
});
