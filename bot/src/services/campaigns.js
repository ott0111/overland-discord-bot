import { getGuild, getMember, saveStore } from "../store.js";
export const CATEGORIES=["social_post","infographic","educational_thread","article","campaign_contribution","video","graphic_design","industry_research","contribution_article","product_feedback","community_initiative","significant_contribution"];
export function activeCampaigns(guildId) { return getGuild(guildId).campaigns.filter(c=>c.status==="ACTIVE" && new Date(c.endsAt)>new Date()); }
export async function createCampaign(guildId, data, actorId) {
  const g=getGuild(guildId), c={id:crypto.randomUUID(),...data,status:"ACTIVE",createdBy:actorId,createdAt:new Date().toISOString()};
  g.campaigns.unshift(c); await saveStore(); return c;
}
export async function submitWork(guildId,user,data) {
  const g=getGuild(guildId), m=getMember(guildId,user);
  const campaign=g.campaigns.find(c=>c.id===data.campaignId && c.status==="ACTIVE");
  if(!campaign || new Date(campaign.endsAt)<new Date()) throw new Error("That campaign is not accepting submissions.");
  if(!/^https:\/\//i.test(data.linkUrl)) throw new Error("Submission link must use HTTPS.");
  const s={id:crypto.randomUUID(),campaignId:campaign.id,memberId:m.id,username:m.username,category:data.category,content:data.content,linkUrl:data.linkUrl,imageUrl:data.imageUrl||null,status:"PENDING",createdAt:new Date().toISOString(),feedback:null,pointsAwarded:0};
  g.submissions.unshift(s); await saveStore(); return s;
}
export async function reviewSubmission(guildId,submissionId,approved,actorId,feedback="") {
  const g=getGuild(guildId), s=g.submissions.find(x=>x.id===submissionId);
  if(!s) throw new Error("Submission not found.");
  if(s.status!=="PENDING") throw new Error("Submission has already been reviewed.");
  s.status=approved?"APPROVED":"REJECTED"; s.reviewedBy=actorId; s.reviewedAt=new Date().toISOString(); s.feedback=feedback;
  if(approved) {
    const c=g.campaigns.find(x=>x.id===s.campaignId);
    const amount=c?.pointReward || g.settings.pointValues[s.category] || 0;
    s.pointsAwarded=Math.max(0,Math.min(100,amount));
    if(s.pointsAwarded) {
      const m=getMember(guildId,s.memberId);
      m.overpoints+=s.pointsAwarded;
      if(["social_post","video","graphic_design","infographic"].includes(s.category)) m.socialPoints+=s.pointsAwarded;
      else if(["industry_research","article","educational_thread","contribution_article"].includes(s.category)) m.contributionPoints+=s.pointsAwarded;
      else m.communityPoints+=s.pointsAwarded;
      g.transactions.unshift({id:crypto.randomUUID(),memberId:m.id,username:m.username,currency:"OVERPOINTS",category:s.category,amount:s.pointsAwarded,balanceAfter:m.overpoints,source:"SOCIAL_SUBMISSION",reason:"Approved campaign submission",actorId,idempotencyKey:"submission:"+s.id,at:new Date().toISOString()});
    }
  }
  await saveStore(); return s;
}
