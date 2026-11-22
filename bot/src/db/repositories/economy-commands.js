import crypto from "node:crypto";
import { getPool } from "../mysql.js";

const BUCKETS = {
  referral: "referral_points",
  social: "social_points",
  contribution: "contribution_points",
  community: "community_points",
};
const SOCIAL = new Set(["social", "social_post", "infographic", "educational_thread", "article", "campaign_contribution", "video"]);
const CONTRIBUTION = new Set(["contribution", "graphic_design", "industry_research", "contribution_article", "product_feedback", "community_initiative", "significant_contribution"]);
function bucketFor(category) {
  if (category === "referral" || String(category).startsWith("referral_")) return "referral";
  if (SOCIAL.has(category)) return "social";
  if (CONTRIBUTION.has(category)) return "contribution";
  return "community";
}
async function resolveMember(connection, guildId, user) {
  const discordId = String(typeof user === "string" ? user : user.id);
  const username = String(typeof user === "string" ? discordId : user.username || user.globalName || discordId).slice(0,100);
  await connection.execute("INSERT IGNORE INTO guilds (guild_id,settings,stats) VALUES (?,JSON_OBJECT(),JSON_OBJECT())",[guildId]);
  const userId = "discord:" + discordId;
  await connection.execute("INSERT INTO users (id,discord_id,username) VALUES (?,?,?) ON DUPLICATE KEY UPDATE username=VALUES(username)",[userId,discordId,username]);
  await connection.execute("INSERT IGNORE INTO discord_members (id,guild_id,user_id) VALUES (?,?,?)",["member:"+guildId+":"+discordId,guildId,userId]);
  const [rows] = await connection.execute("SELECT dm.id,u.username FROM discord_members dm JOIN users u ON u.id=dm.user_id WHERE dm.guild_id=? AND u.discord_id=? LIMIT 1",[guildId,discordId]);
  if (!rows.length) throw new Error("Unable to resolve guild member.");
  return {id:rows[0].id,username:rows[0].username,discordId};
}
async function settings(connection,guildId) {
  const [rows] = await connection.execute("SELECT settings FROM guilds WHERE guild_id=? LIMIT 1",[guildId]);
  let value=rows[0]?.settings||{};
  if(typeof value==="string"){try{value=JSON.parse(value)}catch{value={}}}
  return value||{};
}
export async function awardNormalized(guildId,user,{currency="OVERPOINTS",amount,category="community",source="STAFF",reason="",actorId="SYSTEM",idempotencyKey}) {
  if(!["OVERPOINTS","OVERCREDITS"].includes(currency)||!Number.isSafeInteger(amount)||amount<=0) throw new Error("Invalid award.");
  const pool=getPool(), conn=await pool.getConnection(), key=String(idempotencyKey||crypto.randomUUID());
  try {
    await conn.beginTransaction();
    const member=await resolveMember(conn,guildId,user);
    const [existing]=await conn.execute("SELECT id FROM point_transactions WHERE idempotency_key=? LIMIT 1",[key]);
    if(existing.length){await conn.commit();return {duplicate:true,member};}
    const config=await settings(conn,guildId), limits=config.dailyLimits||{};
    const limit=Number(limits[currency]);
    if(source!=="ADMIN_ADJUSTMENT"&&Number.isFinite(limit)){
      const [usedRows]=await conn.execute("SELECT COALESCE(SUM(amount),0) AS used FROM point_transactions WHERE guild_id=? AND member_id=? AND currency=? AND amount>0 AND created_at>=UTC_DATE()",[guildId,member.id,currency]);
      if(Number(usedRows[0].used)+amount>limit) throw new Error("Daily "+currency+" earning limit reached.");
    }
    await conn.execute("INSERT IGNORE INTO point_balances (member_id,guild_id) VALUES (?,?)",[member.id,guildId]);
    const [balances]=await conn.execute("SELECT overpoints,overcredits FROM point_balances WHERE member_id=? FOR UPDATE",[member.id]);
    const field=currency==="OVERPOINTS"?"overpoints":"overcredits", after=Number(balances[0][field])+amount;
    if(!Number.isSafeInteger(after)) throw new Error("Balance exceeds safe limits.");
    const bucket=bucketFor(category);
    if(currency==="OVERPOINTS") await conn.execute("UPDATE point_balances SET "+field+"=?, "+bucket+"="+bucket+"+? WHERE member_id=?",[after,amount,member.id]);
    else await conn.execute("UPDATE point_balances SET "+field+"=? WHERE member_id=?",[after,member.id]);
    await conn.execute("INSERT INTO point_transactions (id,guild_id,member_id,currency,category,amount,balance_after,source,idempotency_key,reason,actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
      [crypto.randomUUID(),guildId,member.id,currency,category,amount,after,source,key,reason||null,actorId||null]);
    await conn.commit();
    return {duplicate:false,member:{...member,[field]:after}};
  } catch(error){await conn.rollback();if(error.code==="ER_DUP_ENTRY")return {duplicate:true};throw error;}
  finally{conn.release();}
}
export async function spendNormalized(guildId,user,amount,reason,idempotencyKey) {
  if(!Number.isSafeInteger(amount)||amount<=0) throw new Error("Invalid amount.");
  const pool=getPool(),conn=await pool.getConnection();
  try{
    await conn.beginTransaction();
    const member=await resolveMember(conn,guildId,user);
    const [existing]=await conn.execute("SELECT id FROM point_transactions WHERE idempotency_key=? LIMIT 1",[idempotencyKey]);
    if(existing.length){await conn.commit();return {duplicate:true,member};}
    await conn.execute("INSERT IGNORE INTO point_balances (member_id,guild_id) VALUES (?,?)",[member.id,guildId]);
    const [rows]=await conn.execute("SELECT overcredits FROM point_balances WHERE member_id=? FOR UPDATE",[member.id]);
    const after=Number(rows[0].overcredits)-amount;
    if(after<0) throw new Error("You do not have enough Overcredits.");
    await conn.execute("UPDATE point_balances SET overcredits=? WHERE member_id=?",[after,member.id]);
    await conn.execute("INSERT INTO point_transactions (id,guild_id,member_id,currency,category,amount,balance_after,source,idempotency_key,reason,actor_id) VALUES (?,?,?,'OVERCREDITS','spend',?,?,'REWARD_CLAIM',?,?,?)",
      [crypto.randomUUID(),guildId,member.id,-amount,after,idempotencyKey,reason||null,member.discordId]);
    await conn.commit();return {duplicate:false,member:{...member,overcredits:after}};
  }catch(error){await conn.rollback();if(error.code==="ER_DUP_ENTRY")return {duplicate:true};throw error;}
  finally{conn.release();}
}
export async function dailyCheckinNormalized(guildId,user) {
  const pool=getPool(),conn=await pool.getConnection(),today=new Date().toISOString().slice(0,10);
  try{
    await conn.beginTransaction();
    const member=await resolveMember(conn,guildId,user);
    const [prior]=await conn.execute("SELECT checkin_date,streak FROM daily_checkins WHERE guild_id=? AND member_id=? ORDER BY checkin_date DESC LIMIT 1 FOR UPDATE",[guildId,member.id]);
    const previous=prior[0]?.checkin_date ? new Date(prior[0].checkin_date).toISOString().slice(0,10) : null;
    if(previous===today) throw new Error("You have already checked in today.");
    const yesterday=new Date(Date.now()-86400000).toISOString().slice(0,10),streak=previous===yesterday?Number(prior[0].streak)+1:1;
    const config=await settings(conn,guildId),values=config.pointValues||{};
    const points=Number(values.daily??5),bonus=streak%7===0?Number(values.streakBonus??10):0;
    for(const [currency,amount,category,source,key] of [
      ["OVERPOINTS",points,"community","DAILY_CHECKIN","daily:"+member.id+":"+today],
      ["OVERCREDITS",bonus,"streak","STREAK_BONUS","streak:"+member.id+":"+today],
    ]){
      if(!amount)continue;
      await conn.execute("INSERT IGNORE INTO point_balances (member_id,guild_id) VALUES (?,?)",[member.id,guildId]);
      const field=currency==="OVERPOINTS"?"overpoints":"overcredits";
      const [b]=await conn.execute("SELECT "+field+" AS balance FROM point_balances WHERE member_id=? FOR UPDATE",[member.id]);
      const after=Number(b[0].balance)+amount;
      await conn.execute("UPDATE point_balances SET "+field+"=?"+(currency==="OVERPOINTS"?",community_points=community_points+"+amount:"")+" WHERE member_id=?",[after,member.id]);
      await conn.execute("INSERT INTO point_transactions (id,guild_id,member_id,currency,category,amount,balance_after,source,idempotency_key,reason,actor_id) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
        [crypto.randomUUID(),guildId,member.id,currency,category,amount,after,source,key,"Daily check-in",member.discordId]);
    }
    await conn.execute("INSERT INTO daily_checkins (id,guild_id,member_id,checkin_date,streak) VALUES (?,?,?,?,?)",[crypto.randomUUID(),guildId,member.id,today,streak]);
    await conn.commit();return {member,streak,points,bonus};
  }catch(error){await conn.rollback();if(error.code==="ER_DUP_ENTRY")throw new Error("You have already checked in today.");throw error;}
  finally{conn.release();}
}
export async function getNormalizedMemberBalance(guildId,discordId) {
 const [rows]=await getPool().execute("SELECT dm.id AS memberId,u.username,pb.overpoints,pb.overcredits,pb.community_points AS communityPoints,pb.social_points AS socialPoints,pb.referral_points AS referralPoints,pb.contribution_points AS contributionPoints FROM discord_members dm JOIN users u ON u.id=dm.user_id LEFT JOIN point_balances pb ON pb.member_id=dm.id WHERE dm.guild_id=? AND u.discord_id=? LIMIT 1",[guildId,discordId]);
 return rows[0]||null;
}
