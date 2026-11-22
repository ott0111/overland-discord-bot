const API_BASE = (process.env.OVERLAND_API_URL || "").replace(/\/$/, "");
const API_SECRET = process.env.OVERLAND_API_SECRET || "";

async function coreApiRequest<T>(path: string, method: "GET" | "POST", body?: unknown): Promise<T> {
  if (!API_BASE || !API_SECRET) {
    throw new Error("Dashboard bridge is not configured. Set OVERLAND_API_URL and OVERLAND_API_SECRET in Vercel.");
  }
  const response = await fetch(API_BASE + path, {
    method,
    headers: {
      Authorization: "Bearer " + API_SECRET,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw new Error("Overland bot API returned " + response.status);
  return response.json() as Promise<T>;
}

export function coreApiGet<T>(path: string): Promise<T> {
  return coreApiRequest<T>(path, "GET");
}

export function coreApiPost<T>(path: string, body: unknown): Promise<T> {
  return coreApiRequest<T>(path, "POST", body);
}

export function configuredGuildId(): string {
  return process.env.DISCORD_GUILD_ID || process.env.GUILD_ID || "";
}
