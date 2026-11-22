import crypto from "node:crypto";
import {getPool} from "../mysql.js";

async function resolveMember(conn,guildId,discordId){
 const [rows]=await conn.execute("SELECT dm.id,u.username,u.discord_id AS discordId FROM discord_members dm JOIN users u ON u.id=dm.user_id WHERE dm.guild_id=? AND u.discord_id=? LIMIT 1",[guildId,String(discordId)]);
 if(!rows.length)throw Object.assign(new Error("Member not found"),{status:404});
 return rows[0];
}
function mapTicket(r){return {id:r.id,number:r.ticketNumber,category:r.category,channelId:r.channelId,status:r.status,claimedBy:r.claimedBy,rating:r.rating,firstResponseAt:r.firstResponseAt,closedAt:r.closedAt,createdAt:r.createdAt,updatedAt:r.updatedAt,member:{id:r.memberId,user:{discordId:r.discordId,username:r.username}}};}
const TICKET_SELECT="SELECT t.id,t.ticket_number AS ticketNumber,t.category,t.channel_id AS channelId,t.member_id AS memberId,t.status,t.claimed_by AS claimedBy,t.rating,t.first_response_at AS firstResponseAt,t.closed_at AS closedAt,t.created_at AS createdAt,t.updated_at AS updatedAt,u.discord_id AS discordId,u.username FROM tickets t JOIN discord_members dm ON dm.id=t.member_id JOIN users u ON u.id=dm.user_id";
export async function listTickets(guildId,{status,id}={}){
 const pool=getPool();
 if(id){
  const [rows]=await pool.execute(TICKET_SELECT+" WHERE t.guild_id=? AND t.id=? LIMIT 1",[guildId,id]);
  if(!rows.length)return null;
  const [messages]=await pool.execute("SELECT id,ticket_id AS ticketId,author_id AS authorId,content,created_at AS createdAt FROM ticket_messages WHERE guild_id=? AND ticket_id=? ORDER BY created_at ASC",[guildId,id]);
  return {...mapTicket(rows[0]),messages};
 }
 const clauses=["t.guild_id=?"],values=[guildId];
 if(status){clauses.push("t.status=?");values.push(status);}
 const [rows]=await pool.execute(TICKET_SELECT+" WHERE "+clauses.join(" AND ")+" ORDER BY t.created_at DESC LIMIT 100",values);
 return rows.map(mapTicket);
}
export async function updateTicket(guildId,id,action,{actorId,rating}={}){
 const pool=getPool(),conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  const [rows]=await conn.execute("SELECT id,status,ticket_number AS ticketNumber FROM tickets WHERE guild_id=? AND id=? FOR UPDATE",[guildId,id]);
  if(!rows.length)throw Object.assign(new Error("Ticket not found"),{status:404});
  const current=rows[0];let sql,data=[];
  if(action==="claim"){sql="UPDATE tickets SET status='CLAIMED',claimed_by=?,first_response_at=COALESCE(first_response_at,UTC_TIMESTAMP(3)) WHERE guild_id=? AND id=?";data=[actorId,guildId,id];}
  else if(action==="close"){sql="UPDATE tickets SET status='CLOSED',closed_at=UTC_TIMESTAMP(3) WHERE guild_id=? AND id=?";data=[guildId,id];}
  else if(action==="reopen"){sql="UPDATE tickets SET status='OPEN',closed_at=NULL WHERE guild_id=? AND id=?";data=[guildId,id];}
  else if(action==="archive"){sql="UPDATE tickets SET status='ARCHIVED' WHERE guild_id=? AND id=?";data=[guildId,id];}
  else if(action==="rate"){if(!Number.isInteger(rating)||rating<1||rating>5)throw Object.assign(new Error("Rating must be between 1 and 5"),{status:400});sql="UPDATE tickets SET rating=? WHERE guild_id=? AND id=?";data=[rating,guildId,id];}
  else throw Object.assign(new Error("Unknown ticket action"),{status:400});
  await conn.execute(sql,data);
  await conn.execute("INSERT INTO audit_logs (id,guild_id,actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?)",[crypto.randomUUID(),guildId,actorId||null,"ticket."+action,"Ticket",id,JSON.stringify({number:current.ticketNumber})]);
  await conn.commit();
  const [updated]=await pool.execute(TICKET_SELECT+" WHERE t.guild_id=? AND t.id=? LIMIT 1",[guildId,id]);
  return mapTicket(updated[0]);
 }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
export async function listRewards(guildId){
 const pool=getPool();
 const [rewards]=await pool.execute("SELECT r.id,r.name,r.description,r.image_url AS imageUrl,r.cost_overcredits AS costOvercredits,r.stock,r.eligibility,r.active,r.created_at AS createdAt,r.updated_at AS updatedAt,(SELECT COUNT(*) FROM reward_claims rc WHERE rc.reward_id=r.id) AS claimsCount FROM rewards r WHERE r.guild_id=? ORDER BY r.created_at DESC",[guildId]);
 const [claims]=await pool.execute("SELECT rc.id,rc.reward_id AS rewardId,rc.member_id AS memberId,rc.status,rc.cost_overcredits AS costOvercredits,rc.reviewed_by AS reviewedBy,rc.created_at AS createdAt,r.name AS rewardName,u.username,u.discord_id AS discordId FROM reward_claims rc JOIN rewards r ON r.id=rc.reward_id JOIN discord_members dm ON dm.id=rc.member_id JOIN users u ON u.id=dm.user_id WHERE rc.guild_id=? ORDER BY rc.created_at DESC LIMIT 100",[guildId]);
 return {rewards:rewards.map(r=>({...r,claimsCount:Number(r.claimsCount),active:Boolean(r.active)})),claims:claims.map(c=>({...c,reward:{id:c.rewardId,name:c.rewardName},member:{id:c.memberId,user:{username:c.username,discordId:c.discordId}}}))};
}
export async function createReward(guildId,input,actorId){
 const id=crypto.randomUUID(),pool=getPool();
 await pool.execute("INSERT INTO rewards (id,guild_id,name,description,image_url,cost_overcredits,stock,eligibility,active) VALUES (?,?,?,?,?,?,?,?,?)",[id,guildId,input.name.trim(),input.description.trim(),input.imageUrl||null,input.costOvercredits,input.stock??null,input.eligibility||null,input.active??true]);
 await pool.execute("INSERT INTO audit_logs (id,guild_id,actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,'reward.create','Reward',?,?)",[crypto.randomUUID(),guildId,actorId||null,id,JSON.stringify({name:input.name.trim()})]);
 const [rows]=await pool.execute("SELECT id,name,description,image_url AS imageUrl,cost_overcredits AS costOvercredits,stock,eligibility,active,created_at AS createdAt FROM rewards WHERE id=?",[id]);
 return rows[0];
}
export async function updateReward(guildId,id,input,actorId){
 const fields=[],values=[];
 for(const [key,col] of [["name","name"],["description","description"],["imageUrl","image_url"],["costOvercredits","cost_overcredits"],["stock","stock"],["eligibility","eligibility"],["active","active"]]){
  if(input[key]!==undefined){fields.push(col+"=?");values.push(input[key]);}
 }
 if(!fields.length)throw Object.assign(new Error("No reward changes supplied"),{status:400});
 const pool=getPool();
 const [result]=await pool.execute("UPDATE rewards SET "+fields.join(", ")+" WHERE guild_id=? AND id=?",[...values,guildId,id]);
 if(!result.affectedRows)throw Object.assign(new Error("Reward not found"),{status:404});
 await pool.execute("INSERT INTO audit_logs (id,guild_id,actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,'reward.update','Reward',?,?)",[crypto.randomUUID(),guildId,actorId||null,id,JSON.stringify(input)]);
 const [rows]=await pool.execute("SELECT id,name,description,image_url AS imageUrl,cost_overcredits AS costOvercredits,stock,eligibility,active,created_at AS createdAt FROM rewards WHERE guild_id=? AND id=?",[guildId,id]);
 return rows[0];
}
export async function claimReward(guildId,discordId,rewardId){
 const pool=getPool(),conn=await pool.getConnection(),claimId=crypto.randomUUID();
 try{
  await conn.beginTransaction();
  const member=await resolveMember(conn,guildId,discordId);
  const [rewards]=await conn.execute("SELECT id,name,cost_overcredits AS cost,stock,eligibility,active FROM rewards WHERE guild_id=? AND id=? FOR UPDATE",[guildId,rewardId]);
  const reward=rewards[0];
  if(!reward||!reward.active)throw new Error("Reward not found or inactive.");
  if(reward.stock===0)throw new Error("This reward is out of stock.");
  if(reward.eligibility){
   const [roles]=await conn.execute("SELECT r.name FROM member_roles mr JOIN roles r ON r.id=mr.role_id WHERE mr.member_id=? AND r.name=? LIMIT 1",[member.id,reward.eligibility]);
   if(!roles.length)throw new Error("This reward requires the "+reward.eligibility+" role.");
  }
  const [active]=await conn.execute("SELECT id FROM reward_claims WHERE guild_id=? AND reward_id=? AND member_id=? AND status IN ('PENDING','APPROVED') LIMIT 1 FOR UPDATE",[guildId,rewardId,member.id]);
  if(active.length)throw new Error("You already have an active claim for this reward.");
  await conn.execute("INSERT IGNORE INTO point_balances (member_id,guild_id) VALUES (?,?)",[member.id,guildId]);
  const [balances]=await conn.execute("SELECT overcredits FROM point_balances WHERE member_id=? FOR UPDATE",[member.id]);
  const after=Number(balances[0].overcredits)-Number(reward.cost);
  if(after<0)throw new Error("Not enough Overcredits.");
  await conn.execute("UPDATE point_balances SET overcredits=? WHERE member_id=?",[after,member.id]);
  await conn.execute("INSERT INTO reward_claims (id,guild_id,reward_id,member_id,status,cost_overcredits,idempotency_key) VALUES (?,?,?,?,'PENDING',?,?)",[claimId,guildId,rewardId,member.id,reward.cost,"claim:"+claimId]);
  if(reward.stock!==null)await conn.execute("UPDATE rewards SET stock=stock-1 WHERE guild_id=? AND id=? AND stock>0",[guildId,rewardId]);
  await conn.execute("INSERT INTO point_transactions (id,guild_id,member_id,currency,category,amount,balance_after,source,idempotency_key,reason,actor_id) VALUES (?,?,?,'OVERCREDITS','reward',?,?,'REWARD_CLAIM',?,?,?)",[crypto.randomUUID(),guildId,member.id,-Number(reward.cost),after,"claim:"+claimId,reward.name,member.discordId]);
  await conn.commit();return {id:claimId,rewardId,memberId:member.id,username:member.username,costOvercredits:reward.cost,status:"PENDING",createdAt:new Date()};
 }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
export async function reviewRewardClaim(guildId,claimId,status,actorId){
 const pool=getPool(),conn=await pool.getConnection();
 try{
  await conn.beginTransaction();
  const [rows]=await conn.execute("SELECT rc.id,rc.status,rc.member_id AS memberId,rc.reward_id AS rewardId,rc.cost_overcredits AS cost,r.name AS rewardName FROM reward_claims rc JOIN rewards r ON r.id=rc.reward_id WHERE rc.guild_id=? AND rc.id=? FOR UPDATE",[guildId,claimId]);
  const claim=rows[0];if(!claim)throw Object.assign(new Error("Claim not found"),{status:404});
  const allowed=status==="APPROVED"?claim.status==="PENDING":status==="REJECTED"?["PENDING","APPROVED"].includes(claim.status):status==="FULFILLED"&&claim.status==="APPROVED";
  if(!allowed)throw Object.assign(new Error("Claim status changed or this transition is not allowed"),{status:409});
  await conn.execute("UPDATE reward_claims SET status=?,reviewed_by=? WHERE guild_id=? AND id=?",[status,actorId||null,guildId,claimId]);
  if(status==="REJECTED"){
   await conn.execute("INSERT IGNORE INTO point_balances (member_id,guild_id) VALUES (?,?)",[claim.memberId,guildId]);
   const [balances]=await conn.execute("SELECT overcredits FROM point_balances WHERE member_id=? FOR UPDATE",[claim.memberId]);
   const after=Number(balances[0].overcredits)+Number(claim.cost);
   await conn.execute("UPDATE point_balances SET overcredits=? WHERE member_id=?",[after,claim.memberId]);
   await conn.execute("INSERT INTO point_transactions (id,guild_id,member_id,currency,category,amount,balance_after,source,idempotency_key,reason,actor_id) VALUES (?,?,?,'OVERCREDITS','reward',?,?,'REWARD_REFUND',?,?,?)",[crypto.randomUUID(),guildId,claim.memberId,Number(claim.cost),after,"refund:"+claimId,"Refund for rejected claim "+claimId,actorId||null]);
   await conn.execute("UPDATE rewards SET stock=stock+1 WHERE guild_id=? AND id=? AND stock IS NOT NULL",[guildId,claim.rewardId]);
  }
  await conn.execute("INSERT INTO audit_logs (id,guild_id,actor_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?,?,?)",[crypto.randomUUID(),guildId,actorId||null,"reward.claim."+status.toLowerCase(),"RewardClaim",claimId,JSON.stringify({refunded:status==="REJECTED"})]);
  await conn.commit();return {id:claimId,status,reviewedBy:actorId};
 }catch(error){await conn.rollback();throw error;}finally{conn.release();}
}
