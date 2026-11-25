import { Events } from "discord.js";
import { getGuild, saveStore } from "../store.js";
import { embed } from "../commands/helpers.js";
import { getConfiguration, saveXCursor, getLatestXPostId, insertXPost, listPendingXPosts, markXPostAnnounced } from "../db/repositories/operations.js";

const lastPoll = new Map();
const POLL_TICK_MS = 30_000;

function numericId(value) {
  return /^\d+$/.test(String(value || ""));
}

async function readConfig(guildId) {
  if (process.env.OVERLAND_STORAGE === "mysql") return getConfiguration(guildId, "xIntegration", {});
  return getGuild(guildId).settings.x || {};
}

async function saveCursor(guildId, config, newestId) {
  const next = { ...config, lastPostId: newestId };
  if (process.env.OVERLAND_STORAGE === "mysql") {
    await saveXCursor(guildId, next);
    const guild = getGuild(guildId);
    guild.settings.x = { ...guild.settings.x, ...next, channelId: next.announcementChannelId || guild.settings.x.channelId };
    await saveStore();
  } else {
    const guild = getGuild(guildId);
    guild.settings.x = { ...guild.settings.x, ...next };
    await saveStore();
  }
  return next;
}

async function fetchRecentPosts(username, bearerToken) {
  const userResponse = await fetch("https://api.x.com/2/users/by/username/" + encodeURIComponent(username), {
    headers: { Authorization: "Bearer " + bearerToken },
    signal: AbortSignal.timeout(10000),
  });
  if (!userResponse.ok) throw new Error("X user lookup returned HTTP " + userResponse.status);
  const userPayload = await userResponse.json();
  const userId = userPayload?.data?.id;
  if (!userId) throw new Error("X user lookup returned no account ID.");
  const query = new URLSearchParams({
    max_results: "10",
    "tweet.fields": "created_at,referenced_tweets,attachments",
    expansions: "attachments.media_keys",
    "media.fields": "url,preview_image_url",
  });
  const response = await fetch("https://api.x.com/2/users/" + encodeURIComponent(userId) + "/tweets?" + query.toString(), {
    headers: { Authorization: "Bearer " + bearerToken },
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("X timeline returned HTTP " + response.status);
  const payload = await response.json();
  const media = new Map((payload?.includes?.media || []).map((item) => [item.media_key, item.url || item.preview_image_url]).filter((item) => item[1]));
  return (payload?.data || []).map((post) => {
    const refs = Array.isArray(post.referenced_tweets) ? post.referenced_tweets : [];
    const isReply = refs.some((ref) => ref.type === "replied_to");
    const isRepost = refs.some((ref) => ref.type === "retweeted");
    const mediaUrls = (post.attachments?.media_keys || []).map((key) => media.get(key)).filter(Boolean);
    return {
      id: String(post.id),
      username,
      text: String(post.text || ""),
      url: "https://x.com/" + encodeURIComponent(username) + "/status/" + post.id,
      createdAt: post.created_at,
      isReply,
      isRepost,
      mediaUrls,
    };
  }).sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true }));
}

async function deliverPending(client, guildId, channelId) {
  if (process.env.OVERLAND_STORAGE !== "mysql") return;
  if (!/^\d{17,20}$/.test(String(channelId || ""))) return;
  const channel = await client.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased()) return;
  const pending = await listPendingXPosts(guildId, 10);
  for (const post of pending) {
    try {
      await channel.send({
        embeds: [embed("OVERLAND ON X", String(post.text).slice(0, 3500) + "\\n\\n" + post.url)],
        allowedMentions: { parse: [] },
      });
      await markXPostAnnounced(guildId, post.id, channelId);
    } catch (error) {
      console.warn("[X Integration] Could not announce post " + post.postId + ":", error.message);
      break;
    }
  }
}

async function pollGuild(client, guildId) {
  const bearerToken = process.env.X_BEARER_TOKEN;
  if (!bearerToken) return;
  const config = await readConfig(guildId);
  if (!config.enabled) return;
  const username = String(config.username || "").replace(/^@/, "").trim();
  const pollMinutes = Math.min(1440, Math.max(1, Number(config.pollMinutes || 15)));
  if (!username) return;
  const now = Date.now();
  if (now - (lastPoll.get(guildId) || 0) < pollMinutes * 60_000) return;
  lastPoll.set(guildId, now);

  const posts = await fetchRecentPosts(username, bearerToken);
  if (!posts.length) return;
  const databaseCursor = process.env.OVERLAND_STORAGE === "mysql" ? await getLatestXPostId(guildId) : null;
  const cursor = config.lastPostId || databaseCursor || null;
  if (!cursor) {
    await saveCursor(guildId, config, posts[posts.length - 1].id);
    console.log("[X Integration] Initial timeline cursor saved for @" + username + "; existing posts were not replayed.");
    return;
  }

  const newer = posts.filter((post) => numericId(post.id) && numericId(cursor) && BigInt(post.id) > BigInt(cursor));
  for (const post of newer) {
    if (config.ignoreReplies !== false && post.isReply) continue;
    if (config.ignoreReposts !== false && post.isRepost) continue;
    if (process.env.OVERLAND_STORAGE === "mysql") await insertXPost(guildId, post);
    else {
      const guild = getGuild(guildId);
      if (!guild.xPosts.some((item) => item.postId === post.id)) {
        guild.xPosts.unshift({ id: post.id, postId: post.id, authorUsername: username, text: post.text, url: post.url, isReply: post.isReply, isRepost: post.isRepost, createdAt: post.createdAt, announcedAt: null });
      }
    }
  }
  const newestId = posts[posts.length - 1].id;
  if (newer.length) {
    if (process.env.OVERLAND_STORAGE === "mysql") await deliverPending(client, guildId, config.announcementChannelId);
    else {
      const guild = getGuild(guildId);
      const channel = await client.channels.fetch(config.channelId).catch(() => null);
      if (channel?.isTextBased()) {
        for (const post of guild.xPosts.filter((item) => !item.announcedAt).slice(0, 10)) {
          await channel.send({ embeds: [embed("OVERLAND ON X", post.text.slice(0, 3500) + "\\n\\n" + post.url)], allowedMentions: { parse: [] } });
          post.announcedAt = new Date().toISOString();
        }
      }
      await saveStore();
    }
  } else {
    await deliverPending(client, guildId, config.announcementChannelId);
  }
  await saveCursor(guildId, config, newestId);
}

export function registerXIntegration(client) {
  client.once(Events.ClientReady, () => {
    const run = async () => {
      for (const guild of client.guilds.cache.values()) {
        try { await pollGuild(client, guild.id); }
        catch (error) { console.warn("[X Integration] Poll failed for guild " + guild.id + ":", error.message); }
      }
    };
    void run();
    const timer = setInterval(() => { void run(); }, POLL_TICK_MS);
    timer.unref?.();
    console.log("[X Integration] Polling scheduler enabled; X_BEARER_TOKEN is required for timeline access.");
  });
}
