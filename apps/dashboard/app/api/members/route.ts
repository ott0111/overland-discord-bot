import type { Prisma } from "@prisma/client";
import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "economy.view");
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const q = (params.get("q") ?? "").trim();
  const page = Math.max(1, Number(params.get("page") ?? "1") || 1);
  const limit = Math.min(100, Math.max(1, Number(params.get("limit") ?? "20") || 20));
  try {
    const where: Prisma.DiscordMemberWhereInput | undefined = q
      ? {
          OR: [
            { user: { username: { contains: q, mode: "insensitive" as const } } },
            { user: { discordId: { contains: q } } },
          ],
        }
      : undefined;
    const [total, items] = await Promise.all([
      prisma.discordMember.count({ where }),
      prisma.discordMember.findMany({
        where,
        take: limit,
        skip: (page - 1) * limit,
        orderBy: { createdAt: "desc" },
        include: { user: true, balance: true, roles: { include: { role: true } } },
      }),
    ]);
    return NextResponse.json({ items, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch {
    return NextResponse.json({ items: [], total: 0, page, pages: 1, db: "unavailable" });
  }
}
