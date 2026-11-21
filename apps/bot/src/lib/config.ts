
import { prisma, audit } from "./db.js";
import { hasPermission } from "./permissions.js";
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
  return info[key] ?? "Content not configured yet. Staff can update it with /setup.";
}
export function clearConfigCache(key?: string): void { if (key) cache.delete(key); else cache.clear(); }


const EDITABLE_INFO_KEYS = new Set([
  "about", "links", "team", "roadmap", "updates", "faq", "opportunities", "socials",
]);

/** Update one public information page. Only internal staff with config.manage can edit it. */
export async function setInfoContent(actorId: string, key: string, content: string): Promise<string> {
  if (!EDITABLE_INFO_KEYS.has(key)) throw new Error("That information page cannot be edited here.");
  if (!(await hasPermission(actorId, "config.manage"))) {
    throw new Error("You do not have permission to edit Overland information.");
  }
  const clean = content.trim();
  if (!clean) throw new Error("Information content cannot be empty.");
  if (clean.length > 3500) throw new Error("Information content must be 3,500 characters or fewer.");

  const current = await getConfig<Record<string, string>>("infoContent", {});
  const next = { ...current, [key]: clean };
  await prisma.botConfiguration.upsert({
    where: { key: "infoContent" },
    update: { value: next as never, updatedBy: actorId },
    create: { key: "infoContent", value: next as never, updatedBy: actorId },
  });
  clearConfigCache("infoContent");
  await audit(actorId, "info.update", "BotConfiguration", "infoContent", { page: key });
  return clean;
}
