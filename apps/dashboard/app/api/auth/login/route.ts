import { NextResponse } from "next/server";
import { DISCORD_OAUTH_URL } from "../../../../lib/auth";
export async function GET() {
  return NextResponse.redirect(DISCORD_OAUTH_URL);
}
