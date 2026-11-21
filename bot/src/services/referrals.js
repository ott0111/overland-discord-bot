import { getGuild, getMember, saveStore } from "../store.js";
import { award } from "./economy.js";
export function existingInvite(guildId, userId) { return Object.entries(getGuild(guildId).invites).find(([, invite]) => invite.memberId === userId && !invite.revokedAt)?.[0] || null; }
export async function createInvite(guildId, user, invite) { const g = getGuild(guildId), m = getMember(guildId, user); g.invites[invite.code] = { memberId: m.id, createdAt: new Date().toISOString(), uses: invite.uses || 0, revokedAt: null }; await saveStore(); return invite; }
export async function recordJoin(guildId, member, code) {
  const g = getGuild(guildId), referred = getMember(guildId, member.user), invite = g.invites[code];
  if (!invite || invite.memberId === referred.id || g.referrals.some(r => r.referredId === referred.id)) return null;
  const referral = { id: crypto.randomUUID(), referrerId: invite.memberId, referredId: referred.id, username: referred.username, inviteCode: code, verified: false, retained7d: false, becameComrade: false, createdAt: new Date().toISOString() };
  g.referrals.unshift(referral); await saveStore(); return referral;
}
export async function verifyReferral(guildId, userId) {
  const g = getGuild(guildId), referral = g.referrals.find(r => r.referredId === userId && !r.verified);
  if (!referral || referral.suspicious) return false;
  await award(guildId, referral.referrerId, { amount: g.settings.pointValues.verifiedReferral ?? 10, currency: "OVERPOINTS", category: "referral", source: "REFERRAL", reason: "Verified referral", idempotencyKey: "referral:" + referral.id });
  referral.verified = true; referral.verifiedAt = new Date().toISOString(); await saveStore(); return true;
}
export async function processReferralMilestones(guildId, clientGuild) {
  const g = getGuild(guildId), now = Date.now();
  for (const referral of g.referrals) {
    if (!referral.verified) continue;
    const referred = g.members[referral.referredId]; if (!referred) continue;
    if (!referral.retained7d && now - new Date(referral.verifiedAt || referral.createdAt).getTime() >= 7 * 86400000) {
      const present = await clientGuild.members.fetch(referral.referredId).then(() => true).catch(() => false);
      if (present) { await award(guildId, referral.referrerId, { amount: g.settings.pointValues.sevenDayActive ?? 10, currency: "OVERPOINTS", category: "referral", source: "REFERRAL_RETENTION", reason: "Referral retained for seven days", idempotencyKey: "retained:" + referral.id }); referral.retained7d = true; }
    }
    if (!referral.becameComrade && referred.roles.includes("Comrade")) { await award(guildId, referral.referrerId, { amount: g.settings.pointValues.comradeBonus ?? 5, currency: "OVERPOINTS", category: "referral", source: "REFERRAL_COMRADE", reason: "Referral became a Comrade", idempotencyKey: "comrade:" + referral.id }); referral.becameComrade = true; }
  }
  await saveStore();
}
export function referralStats(guildId, userId) { const rows = getGuild(guildId).referrals.filter(r => r.referrerId === userId); return { total: rows.length, verified: rows.filter(r => r.verified).length, retained: rows.filter(r => r.retained7d).length, rows }; }
