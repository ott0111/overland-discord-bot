
import { prisma } from "./db.js";
/** Founder (Owner group) has full control. Public Discord roles NEVER grant admin rights. */
export async function hasPermission(discordId: string, permissionKey: string): Promise<boolean> {
  const record = await prisma.internalTeamMember.findUnique({ where: { discordId }, include: { group: { include: { permissions: true } } } });
  if (!record || record.status !== "ACTIVE") return false;
  if (record.group.name === "Owner") return true;
  return record.group.permissions.some((p: { key: string }) => p.key === permissionKey);
}
export async function isStaff(discordId: string): Promise<boolean> {
  const r = await prisma.internalTeamMember.findUnique({ where: { discordId } });
  return Boolean(r && r.status === "ACTIVE");
}
/** Pure helper used by tests: Owner group bypasses all checks. */
export function groupHasPermission(groupName: string, granted: string[], key: string): boolean {
  if (groupName === "Owner") return true;
  return granted.includes(key);
}
