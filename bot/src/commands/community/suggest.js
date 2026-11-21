import { SlashCommandBuilder } from "discord.js";
import { command, reply, embed } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
export default command(new SlashCommandBuilder().setName("suggest").setDescription("Submit an idea for the Overland community")
 .addStringOption(o=>o.setName("idea").setDescription("Your suggestion").setMaxLength(1500).setRequired(true)),
 async i=>{const g=getGuild(i.guildId),id="S-"+Date.now().toString(36).toUpperCase(),record={id,userId:i.user.id,idea:i.options.getString("idea",true),status:"PENDING",createdAt:new Date().toISOString(),votes:0};g.suggestions.unshift(record);await saveStore();const ch=g.settings.suggestionChannelId?await i.guild.channels.fetch(g.settings.suggestionChannelId).catch(()=>null):i.channel;if(ch?.isTextBased())await ch.send({embeds:[embed("COMMUNITY SUGGESTION  /  "+id,record.idea).addFields({name:"SUBMITTED BY",value:i.user.tag,inline:true},{name:"STATUS",value:"Pending review",inline:true})]});return reply(i,"SUGGESTION SUBMITTED","Reference **"+id+"** has been added to the review queue. Thank you for helping improve Overland.");}
);