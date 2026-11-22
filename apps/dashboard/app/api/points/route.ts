import { NextResponse } from "next/server";
import { coreApiGet, coreApiPost, configuredGuildId } from "../../../lib/core-api";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

function apiFailure(error: unknown) {
  const status = typeof error === "object" && error !== null && "status" in error ? Number((error as {status?:number}).status) : 503;
  const safeStatus = status >= 400 && status < 600 ? status : 503;
  return NextResponse.json({ error: safeStatus === 503 ? "Economy service unavailable" : error instanceof Error ? error.message : "Request failed" }, { status: safeStatus });
}

export async function GET(req: Request) {
  const { session, error } = await requireStaff(req, "economy.view");
  if (error) return error;
  const guildId = configuredGuildId();
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  const params = new URL(req.url).searchParams;
  const path = "/v1/guilds/" + encodeURIComponent(guildId) + "/points?actorId=" + encodeURIComponent(session!.discordId) +
    "&memberId=" + encodeURIComponent(params.get("memberId") || "") + "&category=" + encodeURIComponent(params.get("category") || "");
  try { return NextResponse.json(await coreApiGet(path)); }
  catch (err) { return apiFailure(err); }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "economy.adjust");
  if (error) return error;
  let body: { memberRef?: string; currency?: string; amount?: number; reason?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 }); }
  if (!body.memberRef || !body.currency || typeof body.amount !== "number" || !Number.isSafeInteger(body.amount) || body.amount === 0 || Math.abs(body.amount) > 1000000000) {
    return NextResponse.json({ error: "memberRef, currency and a non-zero amount are required" }, { status: 400 });
  }
  if (body.currency !== "OVERPOINTS" && body.currency !== "OVERCREDITS") {
    return NextResponse.json({ error: "currency must be OVERPOINTS or OVERCREDITS" }, { status: 400 });
  }
  const guildId = configuredGuildId();
  if (!/^\d{17,20}$/.test(guildId)) return NextResponse.json({ error: "Discord guild is not configured" }, { status: 500 });
  try {
    const result = await coreApiPost("/v1/guilds/" + encodeURIComponent(guildId) + "/points", { ...body, actorId: session!.discordId });
    return NextResponse.json(result);
  } catch (err) { return apiFailure(err); }
}
