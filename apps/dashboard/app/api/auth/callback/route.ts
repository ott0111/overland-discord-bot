import { NextResponse } from "next/server";
import { exchangeCodeForSession, setSessionCookie } from "../../../../lib/auth";

/** Discord OAuth2 callback: exchange code, identify the user, check staff record. */
export async function GET(req: Request) {
  const code = new URL(req.url).searchParams.get("code");
  if (!code) return NextResponse.json({ error: "Missing code" }, { status: 400 });
  try {
    const session = await exchangeCodeForSession(code);
    const res = NextResponse.redirect(new URL("/", req.url));
    setSessionCookie(res, session);
    return res;
  } catch {
    return NextResponse.redirect(new URL("/?auth=failed", req.url));
  }
}
