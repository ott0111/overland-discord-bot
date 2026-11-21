import { SlashCommandBuilder } from "discord.js";
import { command, reply, embed } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
export default command(new SlashCommandBuilder().setName("report").setDescription("Privately report a member or safety concern")
 .addUserOption(o=>o.setName("member").setDescription("Member being reported").setRequired(true))
 .addStringOption(o=>o.setName("details").setDescription("What happened?").setMaxLength(1500).setRequired(true)),
 async i=>{const g=getGuild(i.guildId),target=i.options.getUser("member",true);if(target.id===i.user.id)throw new Error("You cannot report yourself.");const rec={id:"R-"+Date.now().toString(36).toUpperCase(),reporterId:i.user.id,targetId:target.id,details:i.options.getString("details",true),status:"OPEN",createdAt:new Date().toISOString()};g.reports.unshift(rec);await saveStore();const ch=g.settings.reportChannelId?await i.guild.channels.fetch(g.settings.reportChannelId).catch(()=>null):null;if(ch?.isTextBased())await ch.send({embeds:[embed("PRIVATE MEMBER REPORT  /  "+rec.id,rec.details).addFields({name:"REPORTER",value:i.user.tag,inline:true},{name:"REPORTED MEMBER",value:target.tag,inline:true})]});return reply(i,"REPORT RECEIVED","Your report has been recorded for staff review. Please do not confront the reported member.");}
);