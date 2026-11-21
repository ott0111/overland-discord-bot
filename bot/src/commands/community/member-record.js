import { SlashCommandBuilder, PermissionFlagsBits } from "discord.js";
import { command, reply, requirePerm } from "../helpers.js";
import { getGuild, getMember, saveStore } from "../../store.js";
export default command(new SlashCommandBuilder().setName("member-record").setDescription("Inspect verification and global community eligibility records")
 .addSubcommand(s=>s.setName("check").setDescription("View a member's Overland record").addUserOption(o=>o.setName("member").setDescription("Member").setRequired(true)))
 .addSubcommand(s=>s.setName("blacklist").setDescription("Add a member to the Overland participation blacklist").addUserOption(o=>o.setName("member").setDescription("Member").setRequired(true)).addStringOption(o=>o.setName("reason").setDescription("Reason").setRequired(true)))
 .addSubcommand(s=>s.setName("unblacklist").setDescription("Remove a member from the participation blacklist").addUserOption(o=>o.setName("member").setDescription("Member").setRequired(true))),
 async i=>{const sub=i.options.getSubcommand(),g=getGuild(i.guildId),u=i.options.getUser("member",true);
 if(sub==="check"){requirePerm(i,"team.manage");const m=getMember(i.guildId,u),b=g.blacklist.find(x=>x.userId===u.id);return reply(i,"MEMBER RECORD  /  "+u.tag,"**Verification:** "+(m.verifiedAt?"Verified":"Not verified")+"\n**Overpoints:** "+m.overpoints+"\n**Overcredits:** "+m.overcredits+"\n**Vouches:** "+g.vouches.filter(v=>v.toId===u.id).length+"\n**Blacklist:** "+(b?"Active • "+b.reason:"Clear"));}
 requirePerm(i,"team.manage");if(sub==="blacklist"){const reason=i.options.getString("reason",true);if(!g.blacklist.some(x=>x.userId===u.id))g.blacklist.unshift({userId:u.id,reason,by:i.user.id,at:new Date().toISOString()});await saveStore();return reply(i,"MEMBER BLACKLISTED",u.tag+" is now flagged as ineligible for Overland-run competitions and participation programs.");}
 g.blacklist=g.blacklist.filter(x=>x.userId!==u.id);await saveStore();return reply(i,"BLACKLIST UPDATED",u.tag+" has been removed from the Overland participation blacklist.");}
);