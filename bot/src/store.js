import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "overland.json");

const defaults = () => ({
  settings: {
    welcomeChannelId: null, autoRoleId: null, welcomeMessage: "Welcome {user} to {server}!",
    welcomeEnabled: false, welcomeDm: false, modLogChannelId: null,
    verificationChannelId: null, verificationEnabled: false, verification: { enabled: true, minAccountAgeDays: 0, requireAvatar: false, antiRaidWindowMinutes: 10, antiRaidThreshold: 10 },
    roleIds: {}, info: {}, links: [], x: { username: null, channelId: null, ignoreReplies: true, ignoreReposts: true, lastPostId: null },
    dailyLimits: { OVERPOINTS: 100, OVERCREDITS: 250 }, pointValues: {
      daily: 10, participation: 2, helpful: 5, event: 15, weekly: 20,
      social_post: 15, infographic: 25, educational_thread: 30, article: 30,
      campaign_contribution: 20, video: 30, graphic_design: 25,
      industry_research: 30, contribution_article: 30, product_feedback: 15,
      community_initiative: 40, significant_contribution: 50
    }
  },
  members: {}, recentJoins: [], transactions: [], roleHistory: [], team: [], campaigns: [],
  submissions: [], rewards: [], claims: [], referrals: [], invites: {},
  achievements: [], moderation: [], tickets: [], checkins: [], xPosts: [],
  stats: { messages: 0, joins: 0, leaves: 0 }
});

let database = { version: 1, guilds: {} };
let saveQueue = Promise.resolve();

export async function loadStore() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  try {
    const raw = await fs.readFile(DATA_FILE, "utf8");
    const parsed = JSON.parse(raw);
    database = parsed && parsed.guilds ? parsed : { version: 1, guilds: {} };
  } catch (error) {
    if (error.code !== "ENOENT") throw new Error("Could not load Overland JSON data: " + error.message);
    database = { version: 1, guilds: {} };
    await saveStore();
  }
  for (const guild of Object.values(database.guilds)) normalizeGuild(guild);
  return database;
}

function normalizeGuild(guild) {
  const base = defaults();
  for (const [key, value] of Object.entries(base)) {
    if (guild[key] === undefined) guild[key] = value;
  }
  guild.settings = { ...base.settings, ...(guild.settings || {}) };
  guild.settings.verification = { ...base.settings.verification, ...(guild.settings.verification || {}) };
  guild.recentJoins ||= [];
  guild.settings.dailyLimits = { ...base.settings.dailyLimits, ...(guild.settings.dailyLimits || {}) };
  guild.settings.pointValues = { ...base.settings.pointValues, ...(guild.settings.pointValues || {}) };
  guild.settings.x = { ...base.settings.x, ...(guild.settings.x || {}) };
  guild.stats = { ...base.stats, ...(guild.stats || {}) };
  guild.members ||= {};
  return guild;
}

export function getGuild(guildId) {
  if (!guildId) throw new Error("This command must be used inside a server.");
  if (!database.guilds[guildId]) database.guilds[guildId] = defaults();
  return normalizeGuild(database.guilds[guildId]);
}

export function getMember(guildId, user) {
  const guild = getGuild(guildId);
  const id = typeof user === "string" ? user : user.id;
  const username = typeof user === "string" ? id : (user.username || user.user?.username || id);
  if (!guild.members[id]) guild.members[id] = {
    id, username, joinedAt: new Date().toISOString(), verifiedAt: null,
    xFollowVerified: false, roles: [], overpoints: 0, overcredits: 0,
    communityPoints: 0, socialPoints: 0, referralPoints: 0, contributionPoints: 0,
    streak: 0, lastCheckin: null, suspicious: false, achievements: []
  };
  guild.members[id].username = username;
  return guild.members[id];
}

export function getDatabase() { return database; }

export function saveStore() {
  saveQueue = saveQueue.then(async () => {
    await fs.mkdir(DATA_DIR, { recursive: true });
    const temp = DATA_FILE + ".tmp";
    await fs.writeFile(temp, JSON.stringify(database, null, 2), "utf8");
    await fs.rename(temp, DATA_FILE);
  });
  return saveQueue;
}

export async function updateGuild(guildId, updates) {
  Object.assign(getGuild(guildId), updates);
  await saveStore();
  return getGuild(guildId);
}

export async function withGuild(guildId, fn) {
  const guild = getGuild(guildId);
  const result = await fn(guild);
  await saveStore();
  return result;
}
