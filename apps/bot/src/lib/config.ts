
import { prisma } from "./db.js";
import { DEFAULT_POINT_VALUES } from "@overland/shared";
const cache = new Map<string, unknown>();
export async function getConfig<T>(key: string, fallback: T): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;
  const row = await prisma.botConfiguration.findUnique({ where: { key } });
  const value = (row?.value as T | undefined) ?? fallback;
  cache.set(key, value);
  return value;
}
export async function getPointValues() { return getConfig("pointValues", DEFAULT_POINT_VALUES); }
export async function getInfoContent(key: string): Promise<string> {
  const info = await getConfig<Record<string, string>>("infoContent", {});
  return info[key] ?? "Content not configured yet. Ask staff to update it in the dashboard.";
}
export function clearConfigCache(key?: string): void { if (key) cache.delete(key); else cache.clear(); }
