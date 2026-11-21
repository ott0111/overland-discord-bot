import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { exchangeCodeForSession, setSessionCookie } from "../../../../lib/auth";

function validOAuthState(req: Request, returnedState: string | null): boolean {
  if (!returnedState) return false;
  const cookie = req.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith("overland_oauth_state="));
  if (!cookie) return false;
  let stored: string;
  try { stored = decodeURIComponent(cookie.slice("overland_oauth_state=".length)); } catch { return false; }
  const expected = Buffer.from(stored);
  const actual = Buffer.from(returnedState);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function clearOAuthState(res: NextResponse): void {
  res.cookies.set("overland_oauth_state", "", {
    httpOnly: true, secure: process.env.NODE_ENV === "production",
    sameSite: "lax", path: "/api/auth/callback", maxAge: 0,
  });
}

/** Discord OAuth2 callback with one-time state validation to prevent login CSRF. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  if (!validOAuthState(req, state)) {
    const response = NextResponse.redirect(new URL("/?auth=state_failed", req.url));
    clearOAuthState(response);
    return response;
  }
  if (!code) {
    const response = NextResponse.json({ error: "Missing code" }, { status: 400 });
    clearOAuthState(response);
    return response;
  }
  try {
    const session = await exchangeCodeForSession(code);
    const response = NextResponse.redirect(new URL("/", req.url));
    setSessionCookie(response, session);
    clearOAuthState(response);
    return response;
  } catch {
    const response = NextResponse.redirect(new URL("/?auth=failed", req.url));
    clearOAuthState(response);
    return response;
  }
}
