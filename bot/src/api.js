import http from "node:http";
import crypto from "node:crypto";
import { timingSafeEqual } from "node:crypto";
import { getGuild, saveStore } from "./store.js";
import { databaseHealth } from "./db/health.js";
import { findStaffMember } from "./db/repositories/staff.js";
import { listTeam, addTeamMember, updateTeamMember, removeTeamMember } from "./db/repositories/team.js";
import { listMembers, getMemberDetails } from "./db/repositories/members.js";
import { listPointTransactions, adjustMemberBalance, getLeaderboard } from "./db/repositories/economy.js";
import { listTickets, updateTicket, listRewards, createReward, updateReward, reviewRewardClaim } from "./db/repositories/tickets-rewards.js";
import { listRoles, createRole, updateRole } from "./db/repositories/roles.js";
import { listAchievements, createAchievement } from "./db/repositories/achievements.js";

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

async function staffRecord(guildId, discordId) {
  if (process.env.OVERLAND_STORAGE === "mysql") {
    const normalized = await findStaffMember(guildId, discordId);
    if (normalized) return normalized;
  }
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


async function readJsonBody(req, maxBytes = 20000) {
  let body = "";
  for await (const chunk of req) {
    body += chunk.toString();
    if (body.length > maxBytes) throw Object.assign(new Error("Request body too large"), { status: 413 });
  }
  try { return JSON.parse(body || "{}"); }
  catch { throw Object.assign(new Error("Invalid JSON body"), { status: 400 }); }
}

async function requireTeamActor(guildId, actorId, permission) {
  if (!/^\d{17,20}$/.test(String(actorId || ""))) throw Object.assign(new Error("A valid staff actor ID is required"), { status: 401 });
  const staff = await staffRecord(guildId, actorId);
  if (!staff.group) throw Object.assign(new Error("Active staff access required"), { status: 403 });
  if (staff.group !== "Owner" && !staff.permissions.includes(permission)) {
    throw Object.assign(new Error("Missing permission: " + permission), { status: 403 });
  }
  return staff;
}

async function appendAudit(guildId, actorId, action, entityId, details = {}, entityType = "InternalTeamMember") {
  const guild = getGuild(guildId);
  guild.audit.unshift({ id: crypto.randomUUID(), actorId, action, entityType, entityId, details, createdAt: new Date().toISOString() });
  if (guild.audit.length > 5000) guild.audit.length = 5000;
  await saveStore();
}

export function startCoreApi() {
  if (!process.env.OVERLAND_API_SECRET) {
    console.warn("[Core API] Disabled: set OVERLAND_API_SECRET to enable the dashboard bridge.");
    return null;
  }
  const port = Number(process.env.OVERLAND_API_PORT || 3001);
  const host = process.env.OVERLAND_API_HOST || "127.0.0.1";
  const server = http.createServer(async (req, res) => {
    if (!authorized(req)) return send(res, 401, { error: "Unauthorized" });
    if (!["GET", "POST", "PATCH", "DELETE"].includes(req.method || "")) return send(res, 405, { error: "Method not allowed" });
    const url = new URL(req.url || "/", "http://localhost");
    if (url.pathname === "/health") {
      const storage = process.env.OVERLAND_STORAGE === "mysql" ? await databaseHealth() : { status: "ok", driver: "json" };
      return send(res, storage.status === "ok" ? 200 : 503, { ok: storage.status === "ok", service: "overland-core-api", storage });
    }
    const staffMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/staff\/(\d{17,20})$/);
    if (staffMatch) return send(res, 200, await staffRecord(staffMatch[1], staffMatch[2]));
    const overviewMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/overview$/);
    if (overviewMatch) return send(res, 200, overview(getGuild(overviewMatch[1])));



    const pointsMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/points$/);
    if (pointsMatch) {
      const guildId = pointsMatch[1];
      if (process.env.OVERLAND_STORAGE !== "mysql") return send(res, 503, { error: "Economy records require MySQL storage to be enabled." });
      try {
        if (req.method === "GET") {
          await requireTeamActor(guildId, url.searchParams.get("actorId"), "economy.view");
          const memberId = url.searchParams.get("memberId") || undefined;
          const category = url.searchParams.get("category") || undefined;
          return send(res, 200, await listPointTransactions(guildId, { memberId, category }));
        }
        if (req.method === "POST") {
          const input = await readJsonBody(req);
          const actor = await requireTeamActor(guildId, input.actorId, "economy.adjust");
          if (!input.memberRef || typeof input.amount !== "number" || !Number.isSafeInteger(input.amount) || input.amount === 0 || Math.abs(input.amount) > 1000000000) {
            return send(res, 400, { error: "memberRef and a non-zero whole-number amount are required" });
          }
          if (!["OVERPOINTS", "OVERCREDITS"].includes(input.currency)) return send(res, 400, { error: "currency must be OVERPOINTS or OVERCREDITS" });
          const balance = await adjustMemberBalance(guildId, String(input.memberRef), input.currency, input.amount, String(input.reason || "").slice(0, 1000), actor.discordId);
          return send(res, 200, { ok: true, balance });
        }
        return send(res, 405, { error: "Method not allowed" });
      } catch (error) {
        return send(res, error.status || 503, { error: error.status ? error.message : "Economy service unavailable" });
      }
    }

    const leaderboardMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/leaderboards$/);
    if (leaderboardMatch) {
      if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
      if (process.env.OVERLAND_STORAGE !== "mysql") return send(res, 503, { error: "Leaderboard records require MySQL storage to be enabled." });
      try {
        await requireTeamActor(leaderboardMatch[1], url.searchParams.get("actorId"), "analytics.view");
        const category = String(url.searchParams.get("category") || "overall").slice(0, 40);
        const period = String(url.searchParams.get("period") || "LIFETIME").toUpperCase();
        return send(res, 200, await getLeaderboard(leaderboardMatch[1], category, ["LIFETIME", "WEEKLY", "MONTHLY"].includes(period) ? period : "LIFETIME"));
      } catch (error) {
        return send(res, error.status || 503, { error: error.status ? error.message : "Leaderboard service unavailable" });
      }
    }

    const membersMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/members$/);
    const memberMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/members\/([^/]+)$/);
    if (membersMatch || memberMatch) {
      const guildId = (membersMatch || memberMatch)[1];
      if (process.env.OVERLAND_STORAGE !== "mysql") return send(res, 503, { error: "Member records require MySQL storage to be enabled." });
      if (req.method !== "GET") return send(res, 405, { error: "Method not allowed" });
      try {
        await requireTeamActor(guildId, url.searchParams.get("actorId"), "economy.view");
        if (membersMatch) {
          const page = Math.min(100000, Math.max(1, Number(url.searchParams.get("page") || 1) || 1));
          const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") || 20) || 20));
          const q = String(url.searchParams.get("q") || "").slice(0, 100);
          return send(res, 200, await listMembers(guildId, { q, page, limit }));
        }
        const member = await getMemberDetails(guildId, decodeURIComponent(memberMatch[2]));
        if (!member) return send(res, 404, { error: "Member not found" });
        return send(res, 200, member);
      } catch (error) {
        return send(res, error.status || 503, { error: error.status ? error.message : "Member service unavailable" });
      }
    }

    const teamMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/team$/);
    if (teamMatch) {
      const guildId = teamMatch[1];
      if (process.env.OVERLAND_STORAGE !== "mysql") return send(res, 503, { error: "Team management requires MySQL storage to be enabled." });
      try {
        if (req.method === "GET") {
          await requireTeamActor(guildId, url.searchParams.get("actorId"), "team.view");
          return send(res, 200, await listTeam(guildId));
        }
        if (req.method === "POST") {
          const input = await readJsonBody(req);
          const actor = await requireTeamActor(guildId, input.actorId, "team.manage");
          if (!/^\d{17,20}$/.test(String(input.discordId || "")) || !String(input.username || "").trim() ||
              !String(input.jobTitle || "").trim() || !String(input.department || "").trim() || !input.groupName) {
            return send(res, 400, { error: "A valid Discord ID, username, job title, department and group are required" });
          }
          if (input.groupName === "Owner" && actor.group !== "Owner") return send(res, 403, { error: "Only an existing Owner can appoint another Owner" });
          const record = await addTeamMember(guildId, input);
          await appendAudit(guildId, actor.discordId, "team.add", record.id, { username: record.username, groupName: input.groupName });
          return send(res, 201, record);
        }
        if (req.method === "PATCH") {
          const input = await readJsonBody(req);
          const actor = await requireTeamActor(guildId, input.actorId, "team.manage");
          if (!input.id) return send(res, 400, { error: "id is required" });
          const record = await updateTeamMember(guildId, String(input.id), input, actor.group === "Owner");
          await appendAudit(guildId, actor.discordId, "team.update", record.id, { username: record.username });
          return send(res, 200, record);
        }
        if (req.method === "DELETE") {
          const actor = await requireTeamActor(guildId, url.searchParams.get("actorId"), "team.manage");
          const id = url.searchParams.get("id");
          if (!id) return send(res, 400, { error: "id is required" });
          const result = await removeTeamMember(guildId, id, actor.group === "Owner");
          await appendAudit(guildId, actor.discordId, "team.remove", id, { status: "REMOVED" });
          return send(res, 200, result);
        }
      } catch (error) {
        return send(res, error.status || 503, { error: error.status ? error.message : "Team management service unavailable" });
      }
    }


    const achievementsMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/achievements$/);
    if (achievementsMatch) {
      const guildId = achievementsMatch[1];
      if (process.env.OVERLAND_STORAGE !== "mysql") return send(res, 503, { error: "Achievement management requires MySQL storage to be enabled." });
      try {
        if (req.method === "GET") {
          await requireTeamActor(guildId, url.searchParams.get("actorId"), "achievements.manage");
          return send(res, 200, await listAchievements(guildId));
        }
        if (req.method === "POST") {
          const input = await readJsonBody(req);
          const actor = await requireTeamActor(guildId, input.actorId, "achievements.manage");
          if (!String(input.name || "").trim() || !String(input.description || "").trim()) return send(res, 400, { error: "name and description are required" });
          const achievement = await createAchievement(guildId, input);
          await appendAudit(guildId, actor.discordId, "achievement.create", achievement.id, { key: achievement.key }, "Achievement");
          return send(res, 201, achievement);
        }
        return send(res, 405, { error: "Method not allowed" });
      } catch (error) {
        return send(res, error.status || 503, { error: error.status ? error.message : "Achievement service unavailable" });
      }
    }

    const rolesMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/roles$/);
    if (rolesMatch) {
      const guildId = rolesMatch[1];
      if (process.env.OVERLAND_STORAGE !== "mysql") return send(res, 503, { error: "Role management requires MySQL storage to be enabled." });
      try {
        if (req.method === "GET") {
          await requireTeamActor(guildId, url.searchParams.get("actorId"), "roles.manage");
          return send(res, 200, await listRoles(guildId));
        }
        if (req.method === "POST") {
          const input = await readJsonBody(req);
          const actor = await requireTeamActor(guildId, input.actorId, "roles.manage");
          if (input.discordRoleId && !/^\d{17,20}$/.test(String(input.discordRoleId))) return send(res, 400, { error: "discordRoleId must be a valid Discord role ID" });
          const role = await createRole(guildId, input);
          await appendAudit(guildId, actor.discordId, "role.create", role.id, { name: role.name }, "Role");
          return send(res, 201, role);
        }
        if (req.method === "PATCH") {
          const input = await readJsonBody(req);
          const actor = await requireTeamActor(guildId, input.actorId, "roles.manage");
          if (!input.id) return send(res, 400, { error: "id is required" });
          if (input.discordRoleId && !/^\d{17,20}$/.test(String(input.discordRoleId))) return send(res, 400, { error: "discordRoleId must be a valid Discord role ID" });
          const role = await updateRole(guildId, String(input.id), input);
          await appendAudit(guildId, actor.discordId, "role.update", role.id, { name: role.name }, "Role");
          return send(res, 200, role);
        }
        return send(res, 405, { error: "Method not allowed" });
      } catch (error) {
        return send(res, error.status || 503, { error: error.status ? error.message : "Role management service unavailable" });
      }
    }

    const ticketsMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/tickets$/);
    if (ticketsMatch) {
      const guildId = ticketsMatch[1];
      if (process.env.OVERLAND_STORAGE !== "mysql") return send(res, 503, { error: "Ticket records require MySQL storage to be enabled." });
      try {
        if (req.method === "GET") {
          await requireTeamActor(guildId, url.searchParams.get("actorId"), "tickets.view");
          const id = url.searchParams.get("id") || undefined;
          const status = url.searchParams.get("status") || undefined;
          if (status && !["OPEN","CLAIMED","CLOSED","ARCHIVED"].includes(status)) return send(res, 400, { error: "Invalid ticket status" });
          const result = await listTickets(guildId, { id, status });
          if (id && !result) return send(res, 404, { error: "Ticket not found" });
          return send(res, 200, result);
        }
        if (req.method === "PATCH") {
          const input = await readJsonBody(req);
          const actor = await requireTeamActor(guildId, input.actorId, "tickets.manage");
          if (!input.id || !input.action) return send(res, 400, { error: "id and action are required" });
          return send(res, 200, await updateTicket(guildId, String(input.id), String(input.action), { actorId: actor.discordId, rating: input.rating }));
        }
        return send(res, 405, { error: "Method not allowed" });
      } catch (error) { return send(res, error.status || 503, { error: error.status ? error.message : "Ticket service unavailable" }); }
    }

    const rewardsMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/rewards$/);
    if (rewardsMatch) {
      const guildId = rewardsMatch[1];
      if (process.env.OVERLAND_STORAGE !== "mysql") return send(res, 503, { error: "Reward records require MySQL storage to be enabled." });
      try {
        if (req.method === "GET") {
          await requireTeamActor(guildId, url.searchParams.get("actorId"), "rewards.view");
          return send(res, 200, await listRewards(guildId));
        }
        if (req.method === "POST") {
          const input = await readJsonBody(req);
          const actor = await requireTeamActor(guildId, input.actorId, "rewards.manage");
          if (!String(input.name || "").trim() || !String(input.description || "").trim() || !Number.isSafeInteger(input.costOvercredits) || input.costOvercredits < 0 || (input.stock !== undefined && input.stock !== null && (!Number.isSafeInteger(input.stock) || input.stock < 0))) return send(res, 400, { error: "Provide a name, description, non-negative integer cost and valid stock" });
          return send(res, 201, await createReward(guildId, input, actor.discordId));
        }
        if (req.method === "PATCH") {
          const input = await readJsonBody(req);
          if (input.claimId && input.status) {
            const actor = await requireTeamActor(guildId, input.actorId, "rewards.review");
            if (!["APPROVED","REJECTED","FULFILLED"].includes(input.status)) return send(res, 400, { error: "Invalid claim status" });
            return send(res, 200, await reviewRewardClaim(guildId, String(input.claimId), input.status, actor.discordId));
          }
          if (input.rewardId) {
            const actor = await requireTeamActor(guildId, input.actorId, "rewards.manage");
            if (input.costOvercredits !== undefined && (!Number.isSafeInteger(input.costOvercredits) || input.costOvercredits < 0)) return send(res, 400, { error: "Reward cost must be a non-negative integer" });
            if (input.stock !== undefined && input.stock !== null && (!Number.isSafeInteger(input.stock) || input.stock < 0)) return send(res, 400, { error: "Stock must be a non-negative integer or null" });
            return send(res, 200, await updateReward(guildId, String(input.rewardId), input, actor.discordId));
          }
          return send(res, 400, { error: "claimId/status or rewardId is required" });
        }
        return send(res, 405, { error: "Method not allowed" });
      } catch (error) { return send(res, error.status || 503, { error: error.status ? error.message : "Reward service unavailable" }); }
    }

    const auditMatch = url.pathname.match(/^\/v1\/guilds\/(\d{17,20})\/audit$/);
    if (auditMatch && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > 20000) req.destroy();
      });
      req.on("end", async () => {
        try {
          const input = JSON.parse(body || "{}");
          const actorId = String(input.actorId || "");
          const staff = await staffRecord(auditMatch[1], actorId);
          if (!staff.group) return send(res, 403, { error: "Active staff access required" });
          const guild = getGuild(auditMatch[1]);
          const entry = {
            id: crypto.randomUUID(),
            actorId,
            action: String(input.action || "operation").slice(0, 120),
            entityType: input.entityType ? String(input.entityType).slice(0, 120) : null,
            entityId: input.entityId ? String(input.entityId).slice(0, 190) : null,
            details: input.details && typeof input.details === "object" ? input.details : {},
            createdAt: new Date().toISOString(),
          };
          guild.audit.unshift(entry);
          if (guild.audit.length > 5000) guild.audit.length = 5000;
          await saveStore();
          return send(res, 201, { ok: true, id: entry.id });
        } catch {
          return send(res, 400, { error: "Invalid audit request" });
        }
      });
      return;
    }
    if (auditMatch && req.method === "GET") {
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
