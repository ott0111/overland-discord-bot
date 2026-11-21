import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
export default command(new SlashCommandBuilder().setName("vouch").setDescription("Leave a reputation vouch for a completed service")
 .addUserOption(o=>o.setName("member").setDescription("Member receiving the vouch").setRequired(true))
 .addStringOption(o=>o.setName("details").setDescription("Describe the completed service").setMaxLength(800).setRequired(true)),
 async i=>{const g=getGuild(i.guildId),target=i.options.getUser("member",true);if(target.id===i.user.id||target.bot)throw new Error("Choose another human member.");if(g.vouches.some(v=>v.fromId===i.user.id&&v.toId===target.id))throw new Error("You have already vouched for this member.");g.vouches.unshift({fromId:i.user.id,toId:target.id,details:i.options.getString("details",true),at:new Date().toISOString()});await saveStore();return reply(i,"VOUCH RECORDED","Your vouch for **"+target.tag+"** has been added to their reputation history.");}
);