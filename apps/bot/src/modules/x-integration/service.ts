import type { Client, TextChannel } from "discord.js";
import { prisma, audit } from "../../lib/db.js";
import { getConfig } from "../../lib/config.js";
import { fetchRecentXPosts, xEnabled, type XPostData } from "../../lib/x-client.js";
import { overlandEmbed } from "../../lib/embeds.js";
import { hasPermission } from "../../lib/permissions.js";
import { logger } from "../../lib/logger.js";

export { fetchRecentXPosts, xEnabled } from "../../lib/x-client.js";

export interface XIntegrationConfig {
  enabled: boolean;
  username: string;
  channelId: string | null;
  ignoreReplies: boolean;
  ignoreReposts: boolean;
  pollMinutes: number;
}

export async function getXConfig(): Promise<XIntegrationConfig> {
  const cfg = await getConfig<Partial<XIntegrationConfig>>("xIntegration", {});
  return {
    enabled: cfg.enabled ?? false,
    username: cfg.username ?? process.env.X_USERNAME ?? "OverlandFinance",
    channelId: cfg.channelId ?? null,
    ignoreReplies: cfg.ignoreReplies ?? true,
    ignoreReposts: cfg.ignoreReposts ?? true,
    pollMinutes: cfg.pollMinutes ?? 15,
  };
}

/** Extract the numeric post id from an x.com / twitter.com status URL. */
export function parsePostIdFromUrl(url: string): string | null {
  const match = url.match(/\/status\/(\d+)/);
  return match ? match[1] : null;
}

export interface XPostLike {
  id: string;
  isReply: boolean;
  isRepost: boolean;
}

/**
 * Pure announce filter, unit tested without a database. Replies and
 * reposts are ignored by default, matching the configured integration
 * behaviour in pollXPosts.
 */
export function shouldAnnouncePost(post: XPostLike, ignoreReplies = true, ignoreReposts = true): boolean {
  if (ignoreReplies && post.isReply) return false;
  if (ignoreReposts && post.isRepost) return false;
  return true;
}

/**
 * Pure X dedupe by postId, unit tested without a database. Drops posts
 * whose id is already in seenPostIds and drops repeated ids inside the
 * batch itself, keeping first-seen order. This is the in-memory mirror of
 * the XPost.postId unique constraint, which is the final guard in the DB.
 */
export function filterNewXPosts<T extends XPostLike>(posts: T[], seenPostIds: Iterable<string>): T[] {
  const seen = new Set(seenPostIds);
  const out: T[] = [];
  for (const post of posts) {
    if (seen.has(post.id)) continue;
    seen.add(post.id);
    out.push(post);
  }
  return out;
}

/** Dedupe a list of post ids, keeping first-seen order. */
export function dedupePostIds(ids: string[]): string[] {
  return [...new Set(ids)];
}

async function postToAnnouncementChannel(client: Client, channelId: string, post: XPostData): Promise<boolean> {
  try {
    const channel = await client.channels.fetch(channelId).catch(() => null);
    if (!channel || !channel.isTextBased()) {
      logger.warn({ channelId }, "X announcement channel is not a text channel");
      return false;
    }
    const embed = overlandEmbed(`New post from @${post.authorUsername}`, post.text.slice(0, 2000))
      .setURL(post.url)
      .addFields({ name: "View on X", value: post.url });
    const firstImage = post.mediaUrls[0];
    if (firstImage) embed.setImage(firstImage);
    await (channel as TextChannel).send({ embeds: [embed] });
    return true;
  } catch (err) {
    logger.error({ err, channelId }, "Failed to post X announcement to Discord");
    return false;
  }
}

/**
 * Poll the official X timeline once and announce new posts.
 *
 * Honest about limitations: when X_BEARER_TOKEN is not set, fetchRecentXPosts
 * returns null and this returns { enabled: false } without inventing posts.
 * Replies and reposts are ignored by default, duplicates are deduped by
 * postId in the XPost table, and every announced post is recorded with the
 * channel it went to.
 */
export async function pollXPosts(client?: Client) {
  const config = await getXConfig();
  if (!config.enabled || !xEnabled()) {
    return { enabled: false, announced: 0, skipped: 0, reason: "X integration is not configured (X_BEARER_TOKEN missing or disabled in config)" };
  }
  const latest = await prisma.xPost.findFirst({ orderBy: { createdAt: "desc" } });
  const posts = await fetchRecentXPosts(config.username, latest?.postId);
  if (!posts) return { enabled: false, announced: 0, skipped: 0, reason: "X API returned no data" };
  let announced = 0;
  let skipped = 0;
  for (const post of posts) {
    if (!shouldAnnouncePost(post, config.ignoreReplies, config.ignoreReposts)) { skipped += 1; continue; }
    const existing = await prisma.xPost.findUnique({ where: { postId: post.id } });
    if (existing?.announcedAt) { skipped += 1; continue; }
    let sent = false;
    if (client && config.channelId) sent = await postToAnnouncementChannel(client, config.channelId, post);
    await prisma.xPost.upsert({
      where: { postId: post.id },
      update: { announcedAt: sent ? new Date() : undefined, announcedChannelId: sent ? config.channelId : undefined },
      create: {
        postId: post.id,
        authorUsername: post.authorUsername,
        text: post.text,
        url: post.url,
        mediaUrls: post.mediaUrls as never,
        isReply: post.isReply,
        isRepost: post.isRepost,
        announcedAt: sent ? new Date() : null,
        announcedChannelId: sent ? config.channelId : null,
      },
    });
    if (sent) announced += 1;
    else skipped += 1;
  }
  return { enabled: true, announced, skipped, reason: null };
}

/**
 * Staff manual announcement of one X post URL. The post id is parsed from
 * the URL, deduped against XPost, and matched against the live timeline
 * when the API is available so the real post text is used. When the API
 * cannot fetch the post, the record is still created with the URL and an
 * empty text field rather than invented copy.
 */
export async function announceManual(url: string, staffDiscordId: string, client?: Client) {
  if (!(await hasPermission(staffDiscordId, "x.manage"))) {
    throw new Error("You do not have permission to manage X announcements");
  }
  const postId = parsePostIdFromUrl(url);
  if (!postId) throw new Error("That URL does not look like an X post link (expected /status/<id>)");
  const existing = await prisma.xPost.findUnique({ where: { postId } });
  if (existing?.announcedAt) throw new Error("That post has already been announced");
  const config = await getXConfig();
  let matched: XPostData | null = null;
  if (xEnabled()) {
    const recent = await fetchRecentXPosts(config.username);
    matched = (recent ?? []).find((p) => p.id === postId) ?? null;
  }
  const post: XPostData = matched ?? {
    id: postId,
    text: "",
    authorUsername: config.username,
    url,
    mediaUrls: [],
    isReply: false,
    isRepost: false,
  };
  let sent = false;
  if (client && config.channelId && post.text) {
    sent = await postToAnnouncementChannel(client, config.channelId, post);
  } else if (client && config.channelId) {
    const channel = await client.channels.fetch(config.channelId).catch(() => null);
    if (channel?.isTextBased()) {
      await (channel as TextChannel).send({ embeds: [overlandEmbed(`New post from @${post.authorUsername}`, `View the post on X: ${url}`).setURL(url)] });
      sent = true;
    }
  }
  const record = await prisma.xPost.upsert({
    where: { postId },
    update: { text: post.text, announcedAt: sent ? new Date() : undefined, announcedChannelId: sent ? config.channelId : undefined },
    create: {
      postId,
      authorUsername: post.authorUsername,
      text: post.text,
      url: post.url,
      mediaUrls: post.mediaUrls as never,
      isReply: false,
      isRepost: false,
      announcedAt: sent ? new Date() : null,
      announcedChannelId: sent ? config.channelId : null,
    },
  });
  await audit(staffDiscordId, "x.announce_manual", "XPost", record.id, { url, sent });
  return { post: record, sent };
}

/** Recent X post history, newest first. */
export async function getPostHistory(take = 50) {
  return prisma.xPost.findMany({ orderBy: { createdAt: "desc" }, take });
}
