import { NextResponse } from "next/server";
import { PERMISSIONS } from "@overland/shared";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req);
  if (error) return error;
  try {
    const groups = await prisma.permissionGroup.findMany({
      orderBy: { name: "asc" },
      include: { permissions: true, _count: { select: { members: true } } },
    });
    return NextResponse.json({ groups, allKeys: [...PERMISSIONS] });
  } catch {
    return NextResponse.json({ groups: [], allKeys: [...PERMISSIONS], db: "unavailable" });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "team.manage");
  if (error) return error;
  const body = (await req.json()) as { groupId?: string; keys?: string[] };
  if (!body.groupId || !Array.isArray(body.keys)) {
    return NextResponse.json({ error: "groupId and keys[] are required" }, { status: 400 });
  }
  const valid = body.keys.filter((k) => (PERMISSIONS as readonly string[]).includes(k));
  try {
    await prisma.$transaction(async (tx: { permission: { deleteMany: (a: unknown) => Promise<unknown>; createMany: (a: unknown) => Promise<unknown> } }) => {
      await tx.permission.deleteMany({ groupId: body.groupId } as never);
      if (valid.length > 0) {
        await tx.permission.createMany({ data: valid.map((key) => ({ key, groupId: body.groupId as string })) } as never);
      }
    });
    await writeAudit(session?.discordId ?? null, "permissions.update", "PermissionGroup", body.groupId, { keys: valid });
    return NextResponse.json({ ok: true, keys: valid });
  } catch {
    return NextResponse.json({ error: "Database unavailable" }, { status: 503 });
  }
}
