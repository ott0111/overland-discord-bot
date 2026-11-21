import { prisma, audit } from "../../lib/db.js";
import { clearConfigCache } from "../../lib/config.js";
import { hasPermission } from "../../lib/permissions.js";

export interface SavedLink { key: string; label: string; url: string; }
export interface WelcomeSettings {
  enabled: boolean;
  channelId: string | null;
  title: string;
  message: string;
}
const DEFAULT_WELCOME: WelcomeSettings = {
  enabled: true,
  channelId: null,
  title: "Welcome to {server}, {user}!",
  message: "We're glad you're here. Read the rules and complete verification to get started.",
};
export function normalizeLinkKey(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "-").replace(/-+/g, "-").slice(0, 32);
}
export function validateLinkUrl(value: string): string {
  let parsed: URL;
  try { parsed = new URL(value); } catch { throw new Error("Enter a valid full URL, including https://"); }
  if (parsed.protocol !== "https:") throw new Error("Only HTTPS links are allowed.");
  if (value.length > 500) throw new Error("Link URLs must be 500 characters or fewer.");
  if (parsed.username || parsed.password) throw new Error("Links cannot contain embedded credentials.");
  return parsed.toString();
}
export async function getSavedLinks(): Promise<SavedLink[]> {
  const row = await prisma.botConfiguration.findUnique({ where: { key: "socialLinks" } });
  const value = row?.value as unknown;
  return Array.isArray(value) ? value.filter((x): x is SavedLink =>
    Boolean(x && typeof x === "object" && typeof (x as SavedLink).key === "string" &&
      typeof (x as SavedLink).label === "string" && typeof (x as SavedLink).url === "string")) : [];
}
export async function saveLink(actorId: string, label: string, url: string, keyInput?: string): Promise<SavedLink> {
  if (!(await hasPermission(actorId, "config.manage"))) throw new Error("You do not have permission to manage bot settings.");
  const key = normalizeLinkKey(keyInput || label);
  if (!key || !label.trim()) throw new Error("A valid link name is required.");
  const safeUrl = validateLinkUrl(url);
  const links = await getSavedLinks();
  const entry = { key, label: label.trim().slice(0, 80), url: safeUrl };
  const next = [...links.filter((x) => x.key !== key), entry].sort((a,b) => a.label.localeCompare(b.label));
  await prisma.botConfiguration.upsert({ where: { key: "socialLinks" }, update: { value: next as never, updatedBy: actorId }, create: { key: "socialLinks", value: next as never, updatedBy: actorId } });
  clearConfigCache("socialLinks");
  await audit(actorId, "settings.link_upsert", "BotConfiguration", key, { label: entry.label, url: safeUrl });
  return entry;
}
export async function removeLink(actorId: string, keyInput: string): Promise<boolean> {
  if (!(await hasPermission(actorId, "config.manage"))) throw new Error("You do not have permission to manage bot settings.");
  const key = normalizeLinkKey(keyInput);
  const links = await getSavedLinks();
  const next = links.filter((x) => x.key !== key);
  if (next.length === links.length) return false;
  await prisma.botConfiguration.upsert({ where: { key: "socialLinks" }, update: { value: next as never, updatedBy: actorId }, create: { key: "socialLinks", value: next as never, updatedBy: actorId } });
  clearConfigCache("socialLinks");
  await audit(actorId, "settings.link_remove", "BotConfiguration", key, {});
  return true;
}
export async function getWelcomeSettings(): Promise<WelcomeSettings> {
  const row = await prisma.botConfiguration.findUnique({ where: { key: "welcome" } });
  return { ...DEFAULT_WELCOME, ...((row?.value as Partial<WelcomeSettings> | null) ?? {}) };
}
export async function updateWelcomeSettings(actorId: string, patch: Partial<WelcomeSettings>): Promise<WelcomeSettings> {
  if (!(await hasPermission(actorId, "config.manage"))) throw new Error("You do not have permission to manage bot settings.");
  const current = await getWelcomeSettings();
  const next = { ...current, ...patch };
  if (next.title.length > 256 || next.message.length > 3500) throw new Error("Welcome title or message is too long.");
  await prisma.botConfiguration.upsert({ where: { key: "welcome" }, update: { value: next as never, updatedBy: actorId }, create: { key: "welcome", value: next as never, updatedBy: actorId } });
  clearConfigCache("welcome");
  await audit(actorId, "settings.welcome_update", "BotConfiguration", "welcome", { ...patch });
  return next;
}
