import {getGuild} from "../store.js";
export function leaderboard(guildId,category="overall",period="LIFETIME",limit=10){
 const g=getGuild(guildId),now=Date.now(),since=period==="WEEKLY"?now-7*86400000:period==="MONTHLY"?now-30*86400000:0;
 const scores=new Map(Object.values(g.members).map(m=>[m.id,{id:m.id,username:m.username,score:period==="LIFETIME"?(category==="referrals"?m.referralPoints:category==="social"?m.socialPoints:category==="contributions"?m.contributionPoints:category==="community"?m.communityPoints:m.overpoints):0}]));
 if(period!=="LIFETIME"){
  for(const tx of g.transactions){if(tx.currency!=="OVERPOINTS"||tx.amount<=0||new Date(tx.at).getTime()<since)continue;const x=scores.get(tx.memberId);if(!x)continue;if(category!=="overall"&&tx.category!==category)continue;x.score+=tx.amount;}
 }
 return [...scores.values()].filter(x=>x.score>0).sort((a,b)=>b.score-a.score).slice(0,limit).map((x,i)=>({...x,rank:i+1}));
}
