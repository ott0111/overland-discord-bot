import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { DISCORD_OAUTH_URL } from "../../../../lib/auth";

export async function GET() {
  const state = randomBytes(32).toString("base64url");
  const response = NextResponse.redirect(DISCORD_OAUTH_URL + "&state=" + encodeURIComponent(state));
  response.cookies.set("overland_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/callback",
    maxAge: 600,
  });
  return response;
}
