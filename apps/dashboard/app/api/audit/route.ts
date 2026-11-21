import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "audit.view");
  if (error) return error;
  const params = new URL(req.url).searchParams;
  const take = Math.min(200, Math.max(1, Number(params.get("take") ?? "100") || 100));
  const action = params.get("action") ?? undefined;
  try {
    return NextResponse.json(
      await prisma.auditLog.findMany({
        where: action ? { action: { contains: action } } : undefined,
        orderBy: { createdAt: "desc" },
        take,
      }),
    );
  } catch {
    return NextResponse.json([]);
  }
}
