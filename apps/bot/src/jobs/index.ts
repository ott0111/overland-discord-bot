import type { Client } from "discord.js";
import { registerJob, enqueue } from "../lib/queue.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { pollXPosts } from "../modules/x-integration/service.js";
import { checkRetention7d } from "../modules/referrals/service.js";

export function registerJobs(client?: Client): void {
  registerJob("referral-retention", async (payload) => {
    await checkRetention7d(String(payload.referralId));
  });

  registerJob("x-poll", async () => {
    const result = await pollXPosts(client);
    if (result.enabled) logger.info({ announced: result.announced, skipped: result.skipped }, "X timeline poll completed");
    else logger.info({ reason: result.reason }, "X timeline poll skipped");
  });

  registerJob("leaderboard-snapshot", async () => {
    const balances = await prisma.pointBalance.findMany({
      orderBy: { overpoints: "desc" }, take: 100, select: { memberId: true, overpoints: true },
    });
    const key = new Date().toISOString().slice(0, 7);
    for (let index = 0; index < balances.length; index++) {
      await prisma.leaderboardSnapshot.create({
        data: { period: "MONTHLY", category: "overall", periodKey: key, memberId: balances[index].memberId, rank: index + 1, score: balances[index].overpoints },
      });
    }
  });
}

export async function scheduleRecurring(): Promise<void> {
  const hourKey = new Date().toISOString().slice(0, 13);
  await enqueue("x-poll", {}, "x-poll-" + hourKey, 0);
  setInterval(() => {
    const key = new Date().toISOString().slice(0, 13);
    enqueue("x-poll", {}, "x-poll-" + key).catch(() => undefined);
  }, 15 * 60 * 1000);
}
