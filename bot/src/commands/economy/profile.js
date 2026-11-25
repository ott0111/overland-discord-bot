import {SlashCommandBuilder} from "discord.js";
import {command,reply} from "../helpers.js";
import {getGuild,getMember} from "../../store.js";
import {getNormalizedMemberBalance} from "../../db/repositories/economy-commands.js";
import {getLeaderboard} from "../../db/repositories/economy.js";
export default command(new SlashCommandBuilder().setName("profile").setDescription("View a community profile").addUserOption(o=>o.setName("member").setDescription("Member")),async i=>{
 const u=i.options.getUser("member")||i.user;
 if(process.env.OVERLAND_STORAGE==="mysql"){
  const m=await getNormalizedMemberBalance(i.guildId,u.id);
  if(!m)return reply(i,"Profile not found","This member has no Overland profile yet.");
  const rows=await getLeaderboard(i.guildId,"overall","LIFETIME");
  const rank=rows.find(x=>x.discordId===u.id)?.rank||"Unranked";
  return reply(i,u.username+" • Profile","Overpoints: "+Number(m.overpoints||0)+"\nOvercredits: "+Number(m.overcredits||0)+"\nRank: "+rank+"\nCommunity: "+Number(m.communityPoints||0)+"\nSocial: "+Number(m.socialPoints||0)+"\nReferrals: "+Number(m.referralPoints||0)+"\nContributions: "+Number(m.contributionPoints||0));
 }
 const m=getMember(i.guildId,u),g=getGuild(i.guildId),rank=Object.values(g.members).filter(x=>x.overpoints>m.overpoints).length+1;
 await reply(i,u.username+" • Profile","Overpoints: "+m.overpoints+"\nOvercredits: "+m.overcredits+"\nRank: #"+rank+"\nCommunity: "+m.communityPoints+"\nSocial: "+m.socialPoints+"\nReferrals: "+m.referralPoints+"\nContributions: "+m.contributionPoints+"\nStreak: "+m.streak+" days\nRoles: "+(m.roles.join(", ")||"None"));
});
