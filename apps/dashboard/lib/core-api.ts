const API_BASE = (process.env.OVERLAND_API_URL || "").replace(/\\/$/, "");
const API_SECRET = process.env.OVERLAND_API_SECRET || "";

export async function coreApiGet<T>(path: string): Promise<T> {
  if (!API_BASE || !API_SECRET) {
    throw new Error("Dashboard bridge is not configured. Set OVERLAND_API_URL and OVERLAND_API_SECRET in Vercel.");
  }
  const response = await fetch(API_BASE + path, {
    method: "GET",
    headers: { Authorization: "Bearer " + API_SECRET, Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new Error("Overland bot API returned " + response.status);
  }
  return response.json() as Promise<T>;
}

export function configuredGuildId(): string {
  return process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || "";
}
