import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "guilds.json");

const defaults = () => ({
  autoRoleId: null,
  welcomeChannelId: null,
  modLogChannelId: null,
  ticketCategoryId: null,
  ticketSupportRoleId: null,
  ticketPanelChannelId: null,
  stats: { messages: 0, joins: 0, leaves: 0 },
  warnings: []
});

let database = { guilds: {} };
let saveQueue = Promise.resolve();

export async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    database = parsed && typeof parsed === "object" && parsed.guilds
      ? parsed
      : { guilds: {} };
  } catch (error) {
    if (error.code !== "ENOENT") {
      console.error("Could not read guild data. Starting with an empty store:", error.message);
    }
    database = { guilds: {} };
    await saveStore();
  }

  return database;
}

export function getGuild(guildId) {
  if (!database.guilds[guildId]) {
    database.guilds[guildId] = defaults();
  }

  const guild = database.guilds[guildId];
  guild.stats ??= { messages: 0, joins: 0, leaves: 0 };
  guild.warnings ??= [];
  return guild;
}

export function updateGuild(guildId, updates) {
  Object.assign(getGuild(guildId), updates);
  return saveStore();
}

export function saveStore() {
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temporaryFile = DATA_FILE + ".tmp";
    await fs.writeFile(temporaryFile, JSON.stringify(database, null, 2), "utf8");
    await fs.rename(temporaryFile, DATA_FILE);
  }).catch((error) => {
    console.error("Could not save guild data:", error);
  });

  return saveQueue;
}
