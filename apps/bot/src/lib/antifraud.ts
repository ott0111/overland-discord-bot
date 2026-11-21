
/** Pure anti-abuse helpers, no database needed, fully unit tested. */
export function isDuplicateMessage(recentHashes: string[], hash: string): boolean { return recentHashes.includes(hash); }
export function hashMessage(content: string): string {
  let h = 0; const s = content.trim().toLowerCase();
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return `h${h}`;
}
export function isSpammy(timestamps: number[], now: number, windowMs: number, max: number): boolean {
  return timestamps.filter((t) => now - t < windowMs).length >= max;
}
export function isSuspiciousAccount(accountAgeDays: number, minAgeDays: number, hasAvatar: boolean): boolean {
  return accountAgeDays < minAgeDays || !hasAvatar;
}
export function detectSelfReferral(referrerId: string, referredId: string): boolean { return referrerId === referredId; }
export function detectReferralBurst(referralsInHour: number, threshold = 5): boolean { return referralsInHour >= threshold; }
export function containsSuspiciousLink(content: string): boolean {
  const lowered = content.toLowerCase();
  return /(discord\.gift|free.*nitro|steamcommunity.*gift|verify.*wallet|connect.*wallet.*claim)/.test(lowered) || /https?:\/\/[^\s]*\.(ru|tk|xyz)\//.test(lowered);
}
export function countMentions(content: string): number { return (content.match(/<@!?\d+>|@everyone|@here/g) ?? []).length; }
