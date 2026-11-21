import {getGuild,getMember,saveStore} from "../store.js";
import {award} from "./economy.js";
export const CATEGORIES=["social_post","infographic","educational_thread","article","campaign_contribution","video","graphic_design","industry_research","contribution_article","product_feedback","community_initiative","significant_contribution"];
export function activeCampaigns(guildId){return getGuild(guildId).campaigns.filter(c=>c.status==="ACTIVE"&&new Date(c.endsAt)>new Date());}
export async function createCampaign(guildId,data,actorId){const g=getGuild(guildId),c={id:crypto.randomUUID(),...data,status:"ACTIVE",createdBy:actorId,createdAt:new Date().toISOString()};g.campaigns.unshift(c);await saveStore();return c;}
export async function submitWork(guildId,user,data){const g=getGuild(guildId),m=getMember(guildId,user),c=g.campaigns.find(x=>x.id===data.campaignId&&x.status==="ACTIVE");if(!c||new Date(c.endsAt)<new Date())throw new Error("That campaign is not accepting submissions.");if(!/^https:\/\//i.test(data.linkUrl))throw new Error("Submission link must use HTTPS.");const s={id:crypto.randomUUID(),campaignId:c.id,memberId:m.id,username:m.username,category:data.category,content:data.content,linkUrl:data.linkUrl,imageUrl:data.imageUrl||null,status:"PENDING",createdAt:new Date().toISOString(),feedback:null,pointsAwarded:0};g.submissions.unshift(s);await saveStore();return s;}
export async function reviewSubmission(guildId,submissionId,approved,actorId,feedback=""){
 const g=getGuild(guildId),s=g.submissions.find(x=>x.id===submissionId);if(!s)throw new Error("Submission not found.");if(s.status!=="PENDING")throw new Error("Submission has already been reviewed.");
 if(approved){
  const c=g.campaigns.find(x=>x.id===s.campaignId),amount=Math.max(0,Math.min(100,c?.pointReward||g.settings.pointValues[s.category]||0));
  const social=["social_post","infographic","video","graphic_design"].includes(s.category),research=["industry_research","article","educational_thread","contribution_article"].includes(s.category);
  if(amount)await award(guildId,s.memberId,{amount,currency:"OVERPOINTS",category:social?"social":research?"contribution":"community",source:"SOCIAL_SUBMISSION",reason:"Approved campaign submission",actorId,idempotencyKey:"submission:"+s.id});
  s.pointsAwarded=amount;
 }
 s.status=approved?"APPROVED":"REJECTED";s.reviewedBy=actorId;s.reviewedAt=new Date().toISOString();s.feedback=feedback;await saveStore();return s;
}
