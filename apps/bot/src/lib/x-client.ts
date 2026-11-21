
import { logger } from "./logger.js";
export interface XPostData { id: string; text: string; authorUsername: string; url: string; mediaUrls: string[]; isReply: boolean; isRepost: boolean; }
export function xEnabled(): boolean { return Boolean(process.env.X_BEARER_TOKEN); }
/** Official X API v2 user timeline. Returns null when not configured, never fakes data. */
export async function fetchRecentXPosts(username: string, sinceId?: string): Promise<XPostData[] | null> {
  const token = process.env.X_BEARER_TOKEN;
  if (!token) { logger.info("X integration disabled: X_BEARER_TOKEN not set"); return null; }
  const params = new URLSearchParams({ "tweet.fields": "referenced_tweets,attachments", "expansions": "attachments.media_keys", "media.fields": "url,preview_image_url,type", max_results: "10" });
  if (sinceId) params.set("since_id", sinceId);
  const userRes = await fetch(`https://api.x.com/2/users/by/username/${encodeURIComponent(username)}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!userRes.ok) { logger.error({ status: userRes.status }, "X API user lookup failed"); return []; }
  const userJson = (await userRes.json()) as { data?: { id: string } };
  if (!userJson.data?.id) return [];
  const res = await fetch(`https://api.x.com/2/users/${userJson.data.id}/tweets?${params}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) { logger.error({ status: res.status }, "X API timeline fetch failed"); return []; }
  const json = (await res.json()) as {
    data?: Array<{
      id: string;
      text: string;
      referenced_tweets?: Array<{ type: string }>;
      attachments?: { media_keys?: string[] };
    }>;
    includes?: {
      media?: Array<{ media_key: string; type?: string; url?: string; preview_image_url?: string }>;
    };
  };
  const mediaByKey = new Map(
    (json.includes?.media ?? []).map((media) => [
      media.media_key,
      media.url ?? media.preview_image_url ?? "",
    ]),
  );
  return (json.data ?? []).map((t) => {
    const refs = t.referenced_tweets ?? [];
    const mediaUrls = (t.attachments?.media_keys ?? [])
      .map((key) => mediaByKey.get(key) ?? "")
      .filter((url): url is string => Boolean(url));
    return {
      id: t.id,
      text: t.text,
      authorUsername: username,
      url: `https://x.com/${username}/status/${t.id}`,
      mediaUrls,
      isReply: refs.some((r) => r.type === "replied_to"),
      isRepost: refs.some((r) => r.type === "retweeted"),
    };
  });
}
