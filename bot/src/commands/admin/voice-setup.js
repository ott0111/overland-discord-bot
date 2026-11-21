import { SlashCommandBuilder, ChannelType } from "discord.js";
import { command, reply, requirePerm } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
export default command(new SlashCommandBuilder().setName("voice-setup").setDescription("Configure temporary voice rooms")
 .addChannelOption(o=>o.setName("lobby").setDescription("Members join this channel to create a room").addChannelTypes(ChannelType.GuildVoice).setRequired(true))
 .addChannelOption(o=>o.setName("category").setDescription("Category for temporary rooms").addChannelTypes(ChannelType.GuildCategory)),
 async i=>{requirePerm(i,"config.manage");const cfg=getGuild(i.guildId).settings.voice;cfg.lobbyChannelId=i.options.getChannel("lobby",true).id;cfg.categoryId=i.options.getChannel("category")?.id||null;cfg.enabled=true;await saveStore();return reply(i,"TEMPORARY VOICE ROOMS ENABLED","Join <#"+cfg.lobbyChannelId+"> to create a private voice room. Empty temporary rooms are automatically removed.");}
);