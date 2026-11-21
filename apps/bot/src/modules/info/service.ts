import { getInfoContent, getConfig } from "../../lib/config.js";
import { prisma } from "../../lib/db.js";
import { INFO_PAGES } from "@overland/shared";

export { getInfoContent } from "../../lib/config.js";

/** Every editable info page key and its current content. */
export async function listInfoPages(): Promise<Array<{ key: string; content: string }>> {
  const info = await getConfig<Record<string, string>>("infoContent", {});
  return INFO_PAGES.map((key) => ({ key, content: info[key] ?? "" }));
}

/** One info page by key, with the configured fallback when unset. */
export async function getInfoPage(key: string): Promise<string> {
  return getInfoContent(key);
}

/** Update one info page. Dashboard only; the bot never hardcodes this copy. */
export async function setInfoPage(key: string, content: string, updatedBy?: string) {
  const info = await getConfig<Record<string, string>>("infoContent", {});
  const next = { ...info, [key]: content };
  await prisma.botConfiguration.upsert({
    where: { key: "infoContent" },
    update: { value: next as never, updatedBy },
    create: { key: "infoContent", value: next as never, updatedBy },
  });
  const { clearConfigCache } = await import("../../lib/config.js");
  clearConfigCache("infoContent");
  return next[key];
}
