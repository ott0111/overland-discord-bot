import { getGuild } from "../store.js";
export function leaderboard(guildId,category="overall",period="LIFETIME",limit=10) {
 const g=getGuild(guildId), now=new Date(), since=new Date(now);
 if(period==="WEEKLY") since.setDate(now.getDate()-7);
 if(period==="MONTHLY") since.setMonth(now.getMonth()-1);
 const scores=new Map();
 for(const m of Object.values(g.members)) scores.set(m.id,{id:m.id,username:m.username,score:category==="referrals"?m.referralPoints:category==="social"?m.socialPoints:category==="contributions"?m.contributionPoints:category==="community"?m.communityPoints:m.overpoints});
 if(period!=="LIFETIME") {
  for(const x of scores.values()) x.score=0;
  for(const tx of g.transactions) if(tx.currency==="OVERPOINTS"&&tx.amount>0&&new Date(tx.at)>=since) {
   const x=scores.get(tx.memberId); if(x) x.score+=category==="referrals"&&tx.category!=="referral"?0:category==="social"&&tx.category!=="social"?0:category==="contributions"&&tx.category!=="contribution"?0:tx.amount;
  }
 }
 return [...scores.values()].filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map((x,i)=>({...x,rank:i+1}));
}
