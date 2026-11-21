import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  const clientId = process.env.DISCORD_CLIENT_ID?.trim();
  const appUrl = process.env.NEXTAUTH_URL?.trim().replace(/\/+$/, "");

  if (!clientId || !appUrl) {
    return NextResponse.redirect(new URL("/?auth=config", req.url));
  }

  const callbackUrl = appUrl + "/api/auth/callback";
  const state = randomBytes(32).toString("base64url");
  const authorizeUrl = new URL("https://discord.com/oauth2/authorize");
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: callbackUrl,
    response_type: "code",
    scope: "identify guilds",
    state,
  }).toString();

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set("overland_oauth_state", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/api/auth/callback",
    maxAge: 600,
  });
  return response;
}
