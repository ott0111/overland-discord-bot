import { getGuild, getMember, saveStore } from "../store.js";
export async function checkAchievements(guildId,user) {
 const g=getGuild(guildId),m=getMember(guildId,user),earned=[];
 const checks=[
  ["first-checkin","First Steps","Complete your first daily check-in",m.lastCheckin],
  ["streak-7","Consistent","Reach a 7 day check-in streak",m.streak>=7],
  ["points-1000","Contributor","Earn 1,000 Overpoints",m.overpoints>=1000],
  ["referral-5","Connector","Refer 5 verified members",g.referrals.filter(r=>r.referrerId===m.id&&r.verified).length>=5],
  ["creator","Creator","Get approved for 3 creative submissions",g.submissions.filter(s=>s.memberId===m.id&&s.status==="APPROVED"&&["social_post","infographic","video","graphic_design"].includes(s.category)).length>=3]
 ];
 for(const [key,name,description,ok] of checks) if(ok&&!m.achievements.includes(key)){m.achievements.push(key);g.achievements.push({key,name,description,memberId:m.id,at:new Date().toISOString()});earned.push(name);}
 if(earned.length) await saveStore(); return earned;
}
