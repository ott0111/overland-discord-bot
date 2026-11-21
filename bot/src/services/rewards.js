import { getGuild, getMember, saveStore } from "../store.js";
export async function createReward(guildId,data,actorId) {
 const g=getGuild(guildId), r={id:crypto.randomUUID(),...data,active:true,createdBy:actorId,createdAt:new Date().toISOString()};
 g.rewards.unshift(r); await saveStore(); return r;
}
export async function claimReward(guildId,user,rewardId) {
 const g=getGuild(guildId), m=getMember(guildId,user), r=g.rewards.find(x=>x.id===rewardId&&x.active);
 if(!r) throw new Error("Reward not found or inactive.");
 if(r.stock===0) throw new Error("This reward is out of stock.");
 if(r.eligibility && !m.roles.includes(r.eligibility)) throw new Error("This reward requires the "+r.eligibility+" role.");
 if(g.claims.some(c=>c.rewardId===rewardId&&c.memberId===m.id&&["PENDING","APPROVED"].includes(c.status))) throw new Error("You already have an active claim for this reward.");
 if(m.overcredits<r.costOvercredits) throw new Error("Not enough Overcredits.");
 m.overcredits-=r.costOvercredits;
 const claim={id:crypto.randomUUID(),rewardId,memberId:m.id,username:m.username,costOvercredits:r.costOvercredits,status:"PENDING",createdAt:new Date().toISOString()};
 g.claims.unshift(claim); if(r.stock!==null&&r.stock!==undefined) r.stock--;
 g.transactions.unshift({id:crypto.randomUUID(),memberId:m.id,username:m.username,currency:"OVERCREDITS",category:"reward",amount:-r.costOvercredits,balanceAfter:m.overcredits,source:"REWARD_CLAIM",reason:r.name,actorId:m.id,idempotencyKey:"claim:"+claim.id,at:new Date().toISOString()});
 await saveStore(); return claim;
}
export async function reviewClaim(guildId,claimId,action,actorId) {
 const g=getGuild(guildId), c=g.claims.find(x=>x.id===claimId);
 if(!c||c.status!=="PENDING") throw new Error("Pending claim not found.");
 const r=g.rewards.find(x=>x.id===c.rewardId), m=getMember(guildId,c.memberId);
 if(action==="approve") c.status="APPROVED";
 else { c.status="REJECTED"; m.overcredits+=c.costOvercredits; if(r&&r.stock!==null&&r.stock!==undefined) r.stock++; }
 c.reviewedBy=actorId; c.reviewedAt=new Date().toISOString(); await saveStore(); return c;
}
