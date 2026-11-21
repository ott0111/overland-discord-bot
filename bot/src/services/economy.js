import { getGuild, getMember, saveStore } from "../store.js";
const dayKey = (date = new Date()) => date.toISOString().slice(0, 10);
const SOCIAL = new Set(["social", "social_post", "infographic", "educational_thread", "article", "campaign_contribution", "video"]);
const CONTRIBUTION = new Set(["contribution", "graphic_design", "industry_research", "contribution_article", "product_feedback", "community_initiative", "significant_contribution"]);
function categoryBucket(category) {
  if (category === "referral" || String(category).startsWith("referral_")) return "referral";
  if (SOCIAL.has(category)) return "social";
  if (CONTRIBUTION.has(category)) return "contribution";
  return "community";
}
export function balanceOf(member) { return { overpoints: member.overpoints, overcredits: member.overcredits, communityPoints: member.communityPoints, socialPoints: member.socialPoints, referralPoints: member.referralPoints, contributionPoints: member.contributionPoints }; }
export async function award(guildId, user, { currency = "OVERPOINTS", amount, category = "community", source = "STAFF", reason = "", actorId = "SYSTEM", idempotencyKey }) {
  if (!["OVERPOINTS", "OVERCREDITS"].includes(currency)) throw new Error("Unknown currency.");
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Award amount must be a positive whole number.");
  const guild = getGuild(guildId), member = getMember(guildId, user), key = idempotencyKey || [source, member.id, category, dayKey(), amount].join(":");
  if (guild.transactions.some(t => t.idempotencyKey === key)) return { duplicate: true, member };
  const currencyKey = currency === "OVERCREDITS" ? "overcredits" : "overpoints", limit = guild.settings.dailyLimits[currency];
  const used = guild.transactions.filter(t => t.memberId === member.id && t.currency === currency && t.at.slice(0, 10) === dayKey() && t.amount > 0).reduce((n, t) => n + t.amount, 0);
  if (source !== "ADMIN_ADJUSTMENT" && Number.isFinite(limit) && used + amount > limit) throw new Error("Daily " + currency + " earning limit reached.");
  member[currencyKey] += amount;
  if (currency === "OVERPOINTS") {
    const bucket = categoryBucket(category);
    if (bucket === "social") member.socialPoints += amount;
    else if (bucket === "referral") member.referralPoints += amount;
    else if (bucket === "contribution") member.contributionPoints += amount;
    else member.communityPoints += amount;
  }
  guild.transactions.unshift({ id: crypto.randomUUID(), memberId: member.id, username: member.username, currency, category, amount, balanceAfter: member[currencyKey], source, reason, actorId, idempotencyKey: key, at: new Date().toISOString() });
  await saveStore(); return { duplicate: false, member };
}
export async function spend(guildId, user, amount, reason, idempotencyKey) {
  if (!Number.isInteger(amount) || amount <= 0) throw new Error("Invalid amount.");
  const guild = getGuild(guildId), member = getMember(guildId, user);
  if (guild.transactions.some(t => t.idempotencyKey === idempotencyKey)) return { duplicate: true, member };
  if (member.overcredits < amount) throw new Error("You do not have enough Overcredits.");
  member.overcredits -= amount;
  guild.transactions.unshift({ id: crypto.randomUUID(), memberId: member.id, username: member.username, currency: "OVERCREDITS", category: "spend", amount: -amount, balanceAfter: member.overcredits, source: "REWARD_CLAIM", reason, actorId: user.id || user, idempotencyKey, at: new Date().toISOString() });
  await saveStore(); return { duplicate: false, member };
}
export async function dailyCheckin(guildId, user) {
  const guild = getGuild(guildId), member = getMember(guildId, user), today = dayKey();
  if (member.lastCheckin === today) throw new Error("You have already checked in today.");
  const yesterday = dayKey(new Date(Date.now() - 86400000)), streak = member.lastCheckin === yesterday ? member.streak + 1 : 1;
  const points = guild.settings.pointValues.daily ?? 5, bonus = streak % 7 === 0 ? (guild.settings.pointValues.streakBonus ?? 10) : 0;
  await award(guildId, user, { amount: points, currency: "OVERPOINTS", category: "community", source: "DAILY_CHECKIN", idempotencyKey: "daily:" + member.id + ":" + today });
  if (bonus) await award(guildId, user, { amount: bonus, currency: "OVERCREDITS", category: "streak", source: "STREAK_BONUS", idempotencyKey: "streak:" + member.id + ":" + today });
  member.streak = streak; member.lastCheckin = today; await saveStore();
  return { member, streak, points, bonus };
}
export async function getTransactions(guildId, userId, limit = 10) { return getGuild(guildId).transactions.filter(t => t.memberId === userId).slice(0, limit); }
