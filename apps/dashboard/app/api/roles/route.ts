import { NextResponse } from "next/server";
import { prisma } from "../../../lib/prisma";
import { requireStaff, writeAudit } from "../../../lib/auth";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const { error } = await requireStaff(req, "roles.manage");
  if (error) return error;
  try {
    const roles = await prisma.role.findMany({
      orderBy: { sortOrder: "asc" },
      include: { requiresRole: true, _count: { select: { members: true } } },
    });
    return NextResponse.json(roles);
  } catch {
    return NextResponse.json([], { status: 200 });
  }
}

export async function POST(req: Request) {
  const { session, error } = await requireStaff(req, "roles.manage");
  if (error) return error;
  const body = (await req.json()) as { name?: string; description?: string; isInternal?: boolean; isSelfAssignable?: boolean; discordRoleId?: string };
  if (!body.name) return NextResponse.json({ error: "name is required" }, { status: 400 });
  try {
    const role = await prisma.role.create({
      data: {
        name: body.name,
        description: body.description ?? null,
        isInternal: Boolean(body.isInternal),
        isSelfAssignable: Boolean(body.isSelfAssignable),
        discordRoleId: body.discordRoleId ?? null,
      },
    });
    await writeAudit(session?.discordId ?? null, "role.create", "Role", role.id, { name: body.name });
    return NextResponse.json(role, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Database unavailable or role already exists" }, { status: 503 });
  }
}

export async function PATCH(req: Request) {
  const { session, error } = await requireStaff(req, "roles.manage");
  if (error) return error;
  const body = (await req.json()) as {
    id?: string; description?: string; isSelfAssignable?: boolean; requiresRoleId?: string | null;
    minOverpoints?: number | null; discordRoleId?: string | null; sortOrder?: number;
  };
  if (!body.id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  try {
    const role = await prisma.role.update({
      where: { id: body.id },
      data: {
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.isSelfAssignable !== undefined ? { isSelfAssignable: body.isSelfAssignable } : {}),
        ...(body.requiresRoleId !== undefined ? { requiresRoleId: body.requiresRoleId } : {}),
        ...(body.minOverpoints !== undefined ? { minOverpoints: body.minOverpoints } : {}),
        ...(body.discordRoleId !== undefined ? { discordRoleId: body.discordRoleId } : {}),
        ...(body.sortOrder !== undefined ? { sortOrder: body.sortOrder } : {}),
      },
    });
    await writeAudit(session?.discordId ?? null, "role.update", "Role", role.id, { name: role.name });
    return NextResponse.json(role);
  } catch {
    return NextResponse.json({ error: "Database unavailable or role not found" }, { status: 503 });
  }
}
