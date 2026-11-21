
import { registerJob, enqueue } from "../lib/queue.js";
import { prisma } from "../lib/db.js";
import { awardPoints } from "../lib/points.js";
import { fetchRecentXPosts, xEnabled } from "../lib/x-client.js";
import { logger } from "../lib/logger.js";
export function registerJobs(): void {
  registerJob("referral-retention", async (p) => {
    const referral = await prisma.referral.findUnique({ where: { id: String(p.referralId) } });
    if (!referral || referral.retained7d) return;
    const referred = await prisma.discordMember.findUnique({ where: { id: referral.referredId } });
    if (referred) { await prisma.referral.update({ where: { id: referral.id }, data: { retained7d: true } }); await awardPoints({ memberId: referral.referrerId, currency: "OVERPOINTS", category: "referral", amount: 10, source: "REFERRAL_RETENTION", reason: "Referral active 7 days", idempotencyKey: `retention-${referral.id}` }); }
  });
  registerJob("x-poll", async () => {
    if (!xEnabled()) { logger.info("X poll skipped: X_BEARER_TOKEN not set"); return; }
    const username = process.env.X_USERNAME ?? "OverlandFinance";
    const latest = await prisma.xPost.findFirst({ orderBy: { createdAt: "desc" } });
    const posts = await fetchRecentXPosts(username, latest?.postId);
    if (!posts) return;
    const cfg = await prisma.botConfiguration.findUnique({ where: { key: "xIntegration" } });
    const conf = (cfg?.value ?? {}) as { ignoreReplies?: boolean; ignoreReposts?: boolean };
    for (const post of posts) {
      if (conf.ignoreReplies !== false && post.isReply) continue;
      if (conf.ignoreReposts !== false && post.isRepost) continue;
      await prisma.xPost.upsert({ where: { postId: post.id }, update: {}, create: { postId: post.id, authorUsername: post.authorUsername, text: post.text, url: post.url, mediaUrls: post.mediaUrls, isReply: post.isReply, isRepost: post.isRepost } });
    }
  });
  registerJob("leaderboard-snapshot", async () => {
    const balances = await prisma.pointBalance.findMany({ orderBy: { overpoints: "desc" }, take: 100, select: { memberId: true, overpoints: true } });
    const key = new Date().toISOString().slice(0, 7);
    for (let idx = 0; idx < balances.length; idx++) await prisma.leaderboardSnapshot.create({ data: { period: "MONTHLY", category: "overall", periodKey: key, memberId: balances[idx].memberId, rank: idx + 1, score: balances[idx].overpoints } });
  });
}
export async function scheduleRecurring(): Promise<void> {
  await enqueue("x-poll", {}, `x-poll-${new Date().toISOString().slice(0, 13)}`, 0);
  setInterval(() => { enqueue("x-poll", {}, `x-poll-${new Date().toISOString().slice(0, 13)}`).catch(() => undefined); }, 15 * 60 * 1000);
}
