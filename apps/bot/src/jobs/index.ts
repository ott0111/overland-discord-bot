import type { Client } from "discord.js";
import { registerJob, enqueue } from "../lib/queue.js";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { pollXPosts } from "../modules/x-integration/service.js";
import { checkRetention7d } from "../modules/referrals/service.js";
import { getXConfig } from "../modules/x-integration/service.js";
import { snapshotLeaderboard } from "../modules/leaderboards/service.js";

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
    const result = await snapshotLeaderboard();
    logger.info(result, "Weekly and monthly leaderboard snapshots refreshed");
  });
}

export async function scheduleRecurring(): Promise<void> {
  let lastPollSlot = "";
  let lastLeaderboardSlot = "";

  const schedulePoll = async () => {
    const config = await getXConfig();
    if (!config.enabled) return;
    const intervalMinutes = Math.max(5, config.pollMinutes);
    const slot = intervalMinutes + "-" + Math.floor(Date.now() / (intervalMinutes * 60 * 1000));
    if (slot === lastPollSlot) return;
    lastPollSlot = slot;
    await enqueue("x-poll", {}, "x-poll-" + slot);
  };

  const scheduleLeaderboards = async () => {
    const slot = String(Math.floor(Date.now() / (60 * 60 * 1000)));
    if (slot === lastLeaderboardSlot) return;
    lastLeaderboardSlot = slot;
    await enqueue("leaderboard-snapshot", {}, "leaderboard-snapshot-" + slot);
  };

  await Promise.all([schedulePoll(), scheduleLeaderboards()]);
  // Re-read configuration each minute so X settings and snapshot schedules apply without a restart.
  setInterval(() => {
    schedulePoll().catch((err) => logger.warn({ err }, "Could not schedule X poll"));
    scheduleLeaderboards().catch((err) => logger.warn({ err }, "Could not schedule leaderboard snapshot"));
  }, 60 * 1000);
}
