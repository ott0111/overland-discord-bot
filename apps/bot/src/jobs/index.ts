import type { Client } from "discord.js";
import { registerJob, enqueue } from "../lib/queue.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { pollXPosts } from "../modules/x-integration/service.js";
import { checkRetention7d } from "../modules/referrals/service.js";
import { getXConfig } from "../modules/x-integration/service.js";

export function registerJobs(client?: Client): void {
  registerJob("referral-retention", async (payload) => {
    const referral = await prisma.referral.findUnique({ where: { id: String(payload.referralId) }, include: { referred: true } });
    if (!referral) return;
    if (!client) throw new Error("Discord client is unavailable for referral retention check");
    const guild = await client.guilds.fetch(referral.referred.guildId);
    await checkRetention7d(String(payload.referralId), guild);
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
  let lastSlot = "";
  const schedulePoll = async () => {
    const config = await getXConfig();
    if (!config.enabled) return;
    const intervalMinutes = Math.max(5, config.pollMinutes);
    const slot = intervalMinutes + "-" + Math.floor(Date.now() / (intervalMinutes * 60 * 1000));
    if (slot === lastSlot) return;
    lastSlot = slot;
    await enqueue("x-poll", {}, "x-poll-" + slot);
  };
  await schedulePoll();
  // Re-read configuration each minute so /x-setup changes apply without a restart.
  setInterval(() => {
    schedulePoll().catch((err) => logger.warn({ err }, "Could not schedule X poll"));
  }, 60 * 1000);
}
