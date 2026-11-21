import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { getPrisma } from "./prisma";

/** Discord OAuth2 for the dashboard. Exchange code for a token, fetch the user, then
 *  check InternalTeamMember + PermissionGroup in the database for RBAC. No session
 *  is trusted without that database check. Staff status is decided at login time;
 *  a session with group === null belongs to a Discord user who is not staff.
 *
 *  Sessions are HMAC-signed (SHA-256) with DASHBOARD_SESSION_SECRET, falling back
 *  to NEXTAUTH_SECRET. An unsigned or tampered cookie is rejected outright, so a
 *  user who can write their own cookies cannot forge a staff session. */
export const SESSION_COOKIE = "overland_session";
export const SESSION_MAX_AGE = 86400;

function sessionSecret(): string {
  const secret = process.env.DASHBOARD_SESSION_SECRET ?? process.env.NEXTAUTH_SECRET ?? "";
  if (!secret) {
    throw new Error("DASHBOARD_SESSION_SECRET (or NEXTAUTH_SECRET) must be set to sign dashboard sessions");
  }
  return secret;
}

function signCookiePayload(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("base64url");
}

export interface DashboardSession {
  discordId: string;
  username: string;
  group: string | null;
  permissions: string[];
}

export function sessionCookieValue(session: DashboardSession): string {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return payload + "." + signCookiePayload(payload);
}

export function setSessionCookie(res: NextResponse, session: DashboardSession): void {
  res.cookies.set(SESSION_COOKIE, sessionCookieValue(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_MAX_AGE,
  });
}

export function clearSessionCookie(res: NextResponse): void {
  res.cookies.set(SESSION_COOKIE, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export function getSessionFromCookie(cookieHeader: string | null): DashboardSession | null {
  if (!cookieHeader) return null;
  const m = cookieHeader.match(/overland_session=([^;]+)/);
  if (!m) return null;
  try {
    const raw = decodeURIComponent(m[1]);
    const dot = raw.lastIndexOf(".");
    if (dot === -1) return null; // Legacy unsigned cookies are rejected.
    const payload = raw.slice(0, dot);
    const signature = raw.slice(dot + 1);
    const expected = signCookiePayload(payload);
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const s = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as DashboardSession;
    if (!s || typeof s.discordId !== "string" || typeof s.username !== "string") return null;
    return { discordId: s.discordId, username: s.username, group: s.group ?? null, permissions: Array.isArray(s.permissions) ? s.permissions : [] };
  } catch {
    return null;
  }
}

/** Read the session from a Request (server routes). */
export async function getSession(req: Request): Promise<DashboardSession | null> {
  return getSessionFromCookie(req.headers.get("cookie"));
}

export function requirePermission(session: DashboardSession | null, key: string): boolean {
  if (!session) return false;
  if (session.group === "Owner") return true;
  return session.permissions.includes(key);
}

export interface AuthResult {
  session: DashboardSession | null;
  error: NextResponse | null;
}

/**
 * Gate for API routes. Returns a 401 when there is no session, a 403 when the
 * session is not staff or lacks the required permission, otherwise the session.
 * Usage: const { session, error } = await requireStaff(req, "tickets.manage");
 *        if (error) return error;
 */
export async function requireStaff(req: Request, permission?: string): Promise<AuthResult> {
  const session = await getSession(req);
  if (!session) {
    return { session: null, error: NextResponse.json({ error: "Unauthorized: sign in with Discord" }, { status: 401 }) };
  }
  if (!session.group) {
    return { session, error: NextResponse.json({ error: "Forbidden: staff access only" }, { status: 403 }) };
  }
  if (permission && !requirePermission(session, permission)) {
    return { session, error: NextResponse.json({ error: "Forbidden: missing permission " + permission }, { status: 403 }) };
  }
  return { session, error: null };
}

/** Alias kept for readability in routes that only need any staff member. */
export const authorize = requireStaff;

export function redirectUri(): string {
  return (process.env.NEXTAUTH_URL ?? "http://localhost:3000") + "/api/auth/callback";
}

export const DISCORD_OAUTH_URL =
  "https://discord.com/oauth2/authorize?client_id=" +
  (process.env.DISCORD_CLIENT_ID ?? "") +
  "&redirect_uri=" + encodeURIComponent(redirectUri()) +
  "&response_type=code&scope=identify%20guilds";

/**
 * Full OAuth2 callback exchange: code -> access token -> /users/@me, then look
 * up the staff record. Never throws for a missing staff record or an
 * unavailable database: those produce a session with group null (no access).
 * Throws only when Discord itself rejects the exchange or the user lookup.
 */
export async function exchangeCodeForSession(code: string): Promise<DashboardSession> {
  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.DISCORD_CLIENT_ID ?? "",
      client_secret: process.env.DISCORD_CLIENT_SECRET ?? "",
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri(),
    }),
  });
  if (!tokenRes.ok) throw new Error("Discord token exchange failed");
  const tokens = (await tokenRes.json()) as { access_token: string };
  const meRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: "Bearer " + tokens.access_token },
  });
  if (!meRes.ok) throw new Error("Discord user lookup failed");
  const me = (await meRes.json()) as { id: string; username: string };
  let session: DashboardSession = { discordId: me.id, username: me.username, group: null, permissions: [] };
  try {
    const staff = await getPrisma().internalTeamMember.findUnique({
      where: { discordId: me.id },
      include: { group: { include: { permissions: true } } },
    });
    if (staff && staff.status === "ACTIVE") {
      session = {
        discordId: me.id,
        username: me.username,
        group: staff.group.name,
        permissions: staff.group.permissions.map((p: { key: string }) => p.key),
      };
    }
  } catch {
    // Database unavailable: session carries no permissions.
  }
  return session;
}

/** Best-effort audit write. Never throws, so logging can never break a route. */
export async function writeAudit(
  actorId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  try {
    await getPrisma().auditLog.create({
      data: {
        actorId: actorId ?? null,
        action,
        entityType: entityType ?? null,
        entityId: entityId ?? null,
        details: (details ?? {}) as never,
      },
    });
  } catch {
    // Audit failure must not fail the request it records.
  }
}
