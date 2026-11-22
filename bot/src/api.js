import http from "node:http";
import { timingSafeEqual } from "node:crypto";
import { getGuild } from "./store.js";
import { databaseHealth } from "./db/health.js";

function authorized(req) {
  const expected = process.env.OVERLAND_API_SECRET || "";
  const supplied = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!expected || !supplied) return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(supplied);
  return a.length === b.length && timingSafeEqual(a, b);
}

function send(res, status, body) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(body));
}

function dateOf(value) {
  const d = new Date(value || 0);
  return Number.isNaN(d.getTime()) ? null : d;
}

function sameDay(value, start, end) {
  const d = dateOf(value);
  return Boolean(d && d >= start && d < end);
}

function overview(g) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const members = Object.values(g.members || {});
  const checkins = Array.isArray(g.checkins) ? g.checkins : [];
  const range = [];
  for (let i = 13; i >= 0; i--) {
    const start = new Date(today);
    start.setDate(start.getDate() - i);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);
    range.push({
      date: start.toISOString().slice(0, 10),
      checkins: checkins.filter((x) => sameDay(x.createdAt || x.at || x.date, start, end)).length,
      joins: members.filter((x) => sameDay(x.joinedAt, start, end)).length,
      points: 0,
    });
  }
  const transactions = Array.isArray(g.transactions) ? g.transactions : [];
  const categories = new Map();
  let pointsToday = 0;
  for (const tx of transactions) {
    const amount = Number(tx.amount || 0);
    if (amount <= 0) continue;
    const category = String(tx.category || tx.reason || "other");
    categories.set(category, (categories.get(category) || 0) + amount);
    if (sameDay(tx.createdAt || tx.at, today, tomorrow)) pointsToday += amount;
    const txDate = dateOf(tx.createdAt || tx.at);
    const day = txDate && range.find((x) => x.date === txDate.toISOString().slice(0, 10));
    if (day) day.points += amount;
  }
  const claims = Array.isArray(g.claims) ? g.claims : [];
  const submissions = Array.isArray(g.submissions) ? g.submissions : [];
  const tickets = Array.isArray(g.tickets) ? g.tickets : [];
  return {
    members: members.length,
    openTickets: tickets.filter((x) => ["OPEN", "CLAIMED"].includes(String(x.status || "").toUpperCase())).length,
    pendingClaims: claims.filter((x) => String(x.status || "").toUpperCase() === "PENDING").length,
    pendingSubmissions: submissions.filter((x) => String(x.status || "").toUpperCase() === "PENDING").length,
    pointsToday,
    checkinsToday: checkins.filter((x) => sameDay(x.createdAt || x.at || x.date, today, tomorrow)).length,
    joinsToday: members.filter((x) => sameDay(x.joinedAt, today, tomorrow)).length,
    pointsByCategory: [...categories.entries()].map(([category, total]) => ({ category, total })).sort((a, b) => b.total - a.total),
    daily: range,
    db: "ok",
  };
}

function staffRecord(guildId, discordId) {
  const g = getGuild(guildId);
  const member = g.team.find((x) => x.discordId === discordId && !["REMOVED", "INACTIVE", "SUSPENDED"].includes(x.status));
  if (!member) return { discordId, username: "", group: null, permissions: [] };
  return {
    discordId,
    username: member.username || discordId,
    group: member.group || null,
    permissions: Array.isArray(member.permissions) ? member.permissions : [],
  };
}

export function startCoreApi() {
  if (!process.env.OVERLAND_API_SECRET) {
    console.warn("[Core API] Disabled: set OVERLAND_API_SECRET to enable the dashboard bridge.");
    return null;
  }
  const port = Number(process.env.OVERLAND_API_PORT || 3001);
  const host = process.env.OVERLAND_API_HOST || "127.0.0.1";
  const server = http.createServer((req, res) => {
    if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
    if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") {
      const storage = process.env.OVERLAND_STORAGE === "mysql" ? await databaseHealth() : { status: "ok", driver: "json" };
      return send(res, storage.status === "ok" ? 200 : 503, { ok: storage.status === "ok", service: "overland-core-api", storage });
    }
    const staffMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/staff\/(\d{17,20})$/);
    if (staffMatch) return send(res, 200, staffRecord(staffMatch[1], staffMatch[2]));
    const overviewMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/overview$/);
    if (overviewMatch) return send(res, 200, overview(getGuild(overviewMatch[1])));
    const auditMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/audit$/);
    if (auditMatch) {
      const take = Math.min(200, Math.max(1, Number(url.searchParams.get("take") || 100)));
      const guild = getGuild(auditMatch[1]);
      const rows = Array.isArray(guild.audit) ? guild.audit : [];
      return send(res, 200, rows.slice(0, take).map((x) => ({
        id: x.id || x.auditId || String(x.at || x.createdAt || ""),
        actorId: x.actorId || x.discordId || null,
        action: x.action || "operation",
        entityType: x.entityType || x.resource || null,
        createdAt: x.createdAt || x.at || new Date().toISOString(),
      })));
    }
    return send(res, 404, { error: "Not found" });
  });
  server.on("error", (error) => console.error("[Core API] Server error:", error.message));
  server.listen(port, host, () => console.log("[Core API] Listening on " + host + ":" + port));
  return server;
}
