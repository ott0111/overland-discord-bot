import fs from "node:fs/promises";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "./db/mysql.js";
import { runMigrations } from "./db/migrate.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.join(ROOT, "data");
const DATA_FILE = path.join(DATA_DIR, "overland.json");

const defaults = () => ({
  settings: {
    welcomeChannelId: null, leaveChannelId: null, autoRoleId: null, verifiedRoleId: null, leaveMessage: "{user} has left {server}.", lockdown: { active: false, previous: {} }, eventLogChannelId: null, suggestionChannelId: null, reportChannelId: null, appealChannelId: null, welcomeMessage: "Welcome {user} to {server}!",
    welcomeEnabled: false, welcomeDm: false, modLogChannelId: null,
    verificationChannelId: null, verificationEnabled: false, verification: { enabled: true, minAccountAgeDays: 0, requireAvatar: false, antiRaidWindowMinutes: 10, antiRaidThreshold: 10 },
    security: { antiSpamEnabled: false, antiLinkEnabled: false, massMentionEnabled: true, spamThreshold: 6, spamWindowMs: 8000, timeoutMinutes: 5, maxMentions: 5, allowedDomains: [] },
    voice: { lobbyChannelId: null, categoryId: null, enabled: false, autoVoiceRooms: {}, voiceSessions: {}, voiceStats: {} },
    roleIds: {}, roleMenus: {}, info: {}, links: [], x: { username: null, channelId: null, ignoreReplies: true, ignoreReposts: true, lastPostId: null },
    dailyLimits: { OVERPOINTS: 100, OVERCREDITS: 250 }, pointValues: {
      daily: 5, participation: 2, helpful: 5, event: 15, weekly: 20, streakBonus: 10, verifiedReferral: 10, sevenDayActive: 10, comradeBonus: 5,
      social_post: 15, infographic: 25, educational_thread: 30, article: 30,
      campaign_contribution: 20, video: 30, graphic_design: 25,
      industry_research: 30, contribution_article: 30, product_feedback: 15,
      community_initiative: 40, significant_contribution: 50
    }
  },
  members: {}, recentJoins: [], transactions: [], roleHistory: [], team: [], campaigns: [],
  submissions: [], rewards: [], claims: [], referrals: [], invites: {},
  achievements: [], moderation: [], tickets: [], checkins: [], xPosts: [], audit: [],
  suggestions: [], reports: [], appeals: [], vouches: [], blacklist: [], tempRoles: [], reminders: [],
  stats: { messages: 0, joins: 0, leaves: 0, deletedMessages: 0, voiceMinutes: 0 }
});

let database = { version: 1, guilds: {} };
let saveQueue = Promise.resolve();
const savedSettings = new Map();
const savedCommunity = new Map();
const COMMUNITY_TYPES = [["suggestions", "SUGGESTION"], ["reports", "REPORT"], ["appeals", "APPEAL"], ["vouches", "VOUCH"], ["blacklist", "BLACKLIST"], ["tempRoles", "TEMP_ROLE"], ["reminders", "REMINDER"]];

export async function loadStore() {
  if (process.env.OVERLAND_STORAGE === "mysql") {
    await runMigrations();
    const [rows] = await getPool().query("SELECT guild_id, data FROM guild_state");
    database = { version: 1, guilds: {} };
    for (const row of rows) {
      const value = typeof row.data === "string" ? JSON.parse(row.data) : row.data;
      database.guilds[row.guild_id] = value;
    }
    for (const guild of Object.values(database.guilds)) normalizeGuild(guild);
    const [communityRows] = await getPool().query("SELECT guild_id, record_type, payload FROM community_records");
    const byGuild = new Map();
    for (const row of communityRows) {
      if (!byGuild.has(row.guild_id)) byGuild.set(row.guild_id, new Map());
      const types = byGuild.get(row.guild_id);
      if (!types.has(row.record_type)) types.set(row.record_type, []);
      const payload = typeof row.payload === "string" ? JSON.parse(row.payload) : row.payload;
      types.get(row.record_type).push(payload);
    }
    for (const [guildId, guild] of Object.entries(database.guilds)) {
      const stored = byGuild.get(guildId) || new Map();
      for (const [collection, type] of COMMUNITY_TYPES) {
        const records = stored.get(type) || [];
        if (records.length) guild[collection] = records;
        if (records.length || !guild[collection]?.length) savedCommunity.set(guildId + ":" + type, JSON.stringify(guild[collection] || []));
      }
    }
    console.log("[Store] Loaded " + rows.length + " guild record(s) and " + communityRows.length + " normalized community record(s) from MySQL.");
    return database;
  }

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

function communityRecordId(guildId, type, record) {
  let identity = record.id;
  if (!identity) {
    if (type === "VOUCH") identity = [record.fromId, record.toId, record.at].join(":");
    else if (type === "TEMP_ROLE") identity = [record.userId, record.roleId, record.expiresAt].join(":");
    else if (type === "BLACKLIST") identity = String(record.userId || record.targetId || JSON.stringify(record));
    else if (type === "REMINDER") identity = [record.userId, record.channelId, record.at, record.text].join(":");
    else identity = JSON.stringify(record);
  }
  return "community_" + crypto.createHash("sha256").update(guildId + ":" + type + ":" + String(identity)).digest("hex").slice(0, 40);
}

function validDiscordId(value) {
  const id = String(value || "");
  return /^\d{17,20}$/.test(id) ? id : null;
}

async function syncCommunityRecords(pool, guildId, guildData) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    for (const [collection, type] of COMMUNITY_TYPES) {
      const records = Array.isArray(guildData[collection]) ? guildData[collection] : [];
      const snapshot = JSON.stringify(records);
      const cacheKey = guildId + ":" + type;
      if (savedCommunity.get(cacheKey) === snapshot) continue;
      const ids = [];
      for (const record of records) {
        const id = communityRecordId(guildId, type, record);
        ids.push(id);
        const subjectId = validDiscordId(record.userId || record.targetId || record.toId || record.memberId);
        const actorId = validDiscordId(record.reporterId || record.fromId || record.grantedBy || record.actorId || record.createdBy || record.userId);
        const status = record.status || (type === "BLACKLIST" || type === "TEMP_ROLE" ? "ACTIVE" : type === "REMINDER" ? "SCHEDULED" : null);
        const rawDate = record.createdAt || record.created_at || (type === "VOUCH" ? record.at : null);
        const parsedDate = rawDate ? new Date(rawDate) : new Date();
        const createdAt = Number.isNaN(parsedDate.getTime()) ? new Date() : parsedDate;
        await connection.execute(
          "INSERT INTO community_records (id, guild_id, record_type, status, subject_id, actor_id, payload, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE status = VALUES(status), subject_id = VALUES(subject_id), actor_id = VALUES(actor_id), payload = VALUES(payload), created_at = VALUES(created_at)",
          [id, guildId, type, status ? String(status).slice(0, 40) : null, subjectId, actorId, JSON.stringify(record), createdAt],
        );
      }
      if (ids.length) {
        await connection.execute("DELETE FROM community_records WHERE guild_id = ? AND record_type = ? AND id NOT IN (" + ids.map(() => "?").join(",") + ")", [guildId, type, ...ids]);
      } else {
        await connection.execute("DELETE FROM community_records WHERE guild_id = ? AND record_type = ?", [guildId, type]);
      }
      savedCommunity.set(cacheKey, snapshot);
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function normalizeGuild(guild) {
  const base = defaults();
  for (const [key, value] of Object.entries(base)) {
    if (guild[key] === undefined) guild[key] = value;
  }
  guild.settings = { ...base.settings, ...(guild.settings || {}) };
  guild.settings.verification = { ...base.settings.verification, ...(guild.settings.verification || {}) };
  guild.settings.security = { ...base.settings.security, ...(guild.settings.security || {}) };
  guild.settings.voice = { ...base.settings.voice, ...(guild.settings.voice || {}) };
  guild.settings.roleMenus ||= {};
  guild.recentJoins ||= [];
  guild.settings.dailyLimits = { ...base.settings.dailyLimits, ...(guild.settings.dailyLimits || {}) };
  guild.settings.pointValues = { ...base.settings.pointValues, ...(guild.settings.pointValues || {}) };
  guild.settings.x = { ...base.settings.x, ...(guild.settings.x || {}) };
  guild.stats = { ...base.stats, ...(guild.stats || {}) };
  guild.members ||= {};
  guild.tempRoles ||= [];
  for (const key of ["suggestions","reports","appeals","vouches","blacklist","reminders"]) guild[key] ||= [];
  guild.settings.voice.autoVoiceRooms ||= {}; guild.settings.voice.voiceSessions ||= {}; guild.settings.voice.voiceStats ||= {};
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
  const username = typeof user === "string" ? null : (user.username || user.user?.username || id);
  if (!guild.members[id]) guild.members[id] = {
    id, username: username || id, joinedAt: new Date().toISOString(), verifiedAt: null,
    xFollowVerified: false, roles: [], overpoints: 0, overcredits: 0,
    communityPoints: 0, socialPoints: 0, referralPoints: 0, contributionPoints: 0,
    streak: 0, lastCheckin: null, suspicious: false, rulesAcceptedAt: null, achievements: []
  };
  if (username) guild.members[id].username = username;
  return guild.members[id];
}

export function getDatabase() { return database; }

export function saveStore() {
  saveQueue = saveQueue.catch(() => {}).then(async () => {
    if (process.env.OVERLAND_STORAGE === "mysql") {
      const pool = getPool();
      for (const [guildId, guildData] of Object.entries(database.guilds)) {
        const settingsJson = JSON.stringify(guildData.settings || {});
        const statsJson = JSON.stringify(guildData.stats || {});
        await pool.execute(
          "INSERT INTO guilds (guild_id, settings, stats) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE settings = VALUES(settings), stats = VALUES(stats)",
          [guildId, settingsJson, statsJson],
        );
        if (savedSettings.get(guildId) !== settingsJson) {
          const settings = guildData.settings || {};
          const x = settings.x || {};
          const configEntries = [
            ["pointValues", settings.pointValues],
            ["dailyLimits", settings.dailyLimits],
            ["verification", settings.verification],
            ["security", settings.security],
            ["infoContent", settings.info],
            ["xIntegration", settings.x ? {
              enabled: x.enabled !== false && Boolean(x.username && x.channelId), username: x.username || null,
              announcementChannelId: x.channelId || null, ignoreReplies: x.ignoreReplies !== false,
              ignoreReposts: x.ignoreReposts !== false, pollMinutes: Number(x.pollMinutes || 15),
              lastPostId: x.lastPostId || null,
            } : null],
            ["welcomeConfig", {
              welcomeChannelId: settings.welcomeChannelId || null,
              leaveChannelId: settings.leaveChannelId || null,
              eventLogChannelId: settings.eventLogChannelId || null,
              welcomeMessage: settings.welcomeMessage || "Welcome {user} to {server}!",
              welcomeEnabled: Boolean(settings.welcomeEnabled), welcomeDm: Boolean(settings.welcomeDm),
            }],
            ["voice", settings.voice],
            ["roleIds", settings.roleIds],
            ["roleMenus", settings.roleMenus],
          ];
          for (const [key, value] of configEntries) {
            if (value === undefined || value === null) continue;
            await pool.execute(
              "INSERT INTO bot_configuration (id, guild_id, config_key, config_value, updated_by) VALUES (?, ?, ?, ?, NULL) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
              [crypto.randomUUID(), guildId, key, JSON.stringify(value)],
            );
          }
          savedSettings.set(guildId, settingsJson);
        }
        await syncCommunityRecords(pool, guildId, guildData);
        await pool.execute(
          "INSERT INTO guild_state (guild_id, data, revision) VALUES (?, ?, 1) ON DUPLICATE KEY UPDATE data = VALUES(data), revision = revision + 1",
          [guildId, JSON.stringify(guildData)],
        );
      }
      return;
    }
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
