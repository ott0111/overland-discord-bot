import { SlashCommandBuilder, ChannelType } from "discord.js";
import { command, reply, requirePerm } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
export default command(new SlashCommandBuilder().setName("community-setup").setDescription("Configure Overland community automation")
 .addSubcommand(s=>s.setName("channels").setDescription("Set welcome, leave, and event log channels")
  .addChannelOption(o=>o.setName("welcome").setDescription("Welcome announcements").addChannelTypes(ChannelType.GuildText))
  .addChannelOption(o=>o.setName("leave").setDescription("Goodbye announcements").addChannelTypes(ChannelType.GuildText))
  .addChannelOption(o=>o.setName("logs").setDescription("Member, message, role, and voice logs").addChannelTypes(ChannelType.GuildText))
  .addChannelOption(o=>o.setName("suggestions").setDescription("Suggestion inbox").addChannelTypes(ChannelType.GuildText))
  .addChannelOption(o=>o.setName("reports").setDescription("Private staff report inbox").addChannelTypes(ChannelType.GuildText))
  .addChannelOption(o=>o.setName("appeals").setDescription("Ban appeal inbox").addChannelTypes(ChannelType.GuildText)))
 .addSubcommand(s=>s.setName("security").setDescription("Toggle automated security filters")
  .addBooleanOption(o=>o.setName("anti-spam").setDescription("Remove repeated spam and apply a short timeout"))
  .addBooleanOption(o=>o.setName("anti-link").setDescription("Remove unapproved links"))
  .addBooleanOption(o=>o.setName("mass-mentions").setDescription("Block excessive mentions"))
  .addIntegerOption(o=>o.setName("spam-threshold").setDescription("Messages within the configured window").setMinValue(3).setMaxValue(15))
  .addIntegerOption(o=>o.setName("timeout-minutes").setDescription("Automod timeout length").setMinValue(1).setMaxValue(60))),
 async i=>{requirePerm(i,"config.manage");const g=getGuild(i.guildId),sub=i.options.getSubcommand();
 if(sub==="channels"){for(const [option,key] of [["welcome","welcomeChannelId"],["leave","leaveChannelId"],["logs","eventLogChannelId"],["suggestions","suggestionChannelId"],["reports","reportChannelId"],["appeals","appealChannelId"]]){const c=i.options.getChannel(option);if(c)g.settings[key]=c.id;}if(i.options.getChannel("welcome"))g.settings.welcomeEnabled=true;await saveStore();return reply(i,"COMMUNITY CHANNELS UPDATED","Your Overland announcement, logging, and submission channels have been saved.");}
 const cfg=g.settings.security;for(const [option,key] of [["anti-spam","antiSpamEnabled"],["anti-link","antiLinkEnabled"],["mass-mentions","massMentionEnabled"]]){const v=i.options.getBoolean(option);if(v!==null)cfg[key]=v;}const threshold=i.options.getInteger("spam-threshold"),mins=i.options.getInteger("timeout-minutes");if(threshold)cfg.spamThreshold=threshold;if(mins)cfg.timeoutMinutes=mins;await saveStore();return reply(i,"SECURITY CONFIGURATION SAVED","Anti-spam: **"+(cfg.antiSpamEnabled?"ON":"OFF")+"**\nLink filter: **"+(cfg.antiLinkEnabled?"ON":"OFF")+"**\nMass mentions: **"+(cfg.massMentionEnabled?"ON":"OFF")+"**\nSpam threshold: **"+cfg.spamThreshold+" messages**\nTimeout: **"+cfg.timeoutMinutes+" minutes**");
});