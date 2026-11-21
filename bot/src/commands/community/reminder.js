import {SlashCommandBuilder} from "discord.js";
import {command,reply} from "../helpers.js";
import {getGuild,saveStore} from "../../store.js";
export default command(new SlashCommandBuilder().setName("reminder").setDescription("Set a reminder in this channel").addIntegerOption(o=>o.setName("minutes").setDescription("When to remind you").setMinValue(1).setMaxValue(10080).setRequired(true)).addStringOption(o=>o.setName("message").setDescription("Reminder text").setRequired(true).setMaxLength(700)),
async i=>{const minutes=i.options.getInteger("minutes",true),text=i.options.getString("message",true),g=getGuild(i.guildId);g.reminders.push({id:"RM-"+Date.now().toString(36),userId:i.user.id,channelId:i.channelId,text,at:new Date(Date.now()+minutes*60000).toISOString()});await saveStore();return reply(i,"Reminder scheduled","I will remind you here in **"+minutes+" minutes**.");});
