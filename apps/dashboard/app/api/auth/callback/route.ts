import { timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import { exchangeCodeForSession, setSessionCookie } from "../../../../lib/auth";

/**
 * Match the returned OAuth state against every cookie with this name.
 * Checking every occurrence also handles stale duplicate cookies left behind
 * by earlier deployments that used a narrower cookie path.
 */
function validOAuthState(req: Request, returnedState: string | null): boolean {
  if (!returnedState) return false;
  const cookies = req.headers.get("cookie")?.split(";").map((part) => part.trim()) ?? [];
  const values = cookies
    .filter((part) => part.startsWith("overland_oauth_state="))
    .map((part) => {
      try {
        return decodeURIComponent(part.slice("overland_oauth_state=".length));
      } catch {
        return "";
      }
    });

  const actual = Buffer.from(returnedState);
  let matched = false;
  for (const stored of values) {
    const expected = Buffer.from(stored);
    if (expected.length === actual.length && timingSafeEqual(expected, actual)) {
      matched = true;
    }
  }
  return matched;
}

function clearOAuthState(res: NextResponse): void {
  const options = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    maxAge: 0,
  };
  // Clear both the current root-scoped cookie and the callback-scoped cookie
  // used by previous deployments.
  res.cookies.set("overland_oauth_state", "", { ...options, path: "/" });
  res.cookies.set("overland_oauth_state", "", { ...options, path: "/api/auth/callback" });
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
