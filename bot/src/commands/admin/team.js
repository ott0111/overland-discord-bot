import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePerm } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
import { listTeam, addTeamMember, removeTeamMember } from "../../db/repositories/team.js";
import { appendAuditLog } from "../../db/repositories/operations.js";
import { syncTeamCacheFromMySQL } from "../../services/permissions.js";

const groups = ["Owner", "Executive", "Administration", "Moderation", "Development", "Support", "Rewards_Management"];
const all = ["roles.manage","roles.verify_x","economy.manage","campaigns.manage","campaigns.review","rewards.manage","rewards.review","config.manage","community.manage","moderation.manage","team.manage","x.manage"];
const map = {
  Owner: all,
  Executive: ["team.manage","community.manage","config.manage"],
  Administration: ["config.manage","roles.manage","economy.manage","campaigns.manage","campaigns.review","rewards.manage","rewards.review"],
  Moderation: ["moderation.manage"],
  Development: ["config.manage"],
  Support: ["moderation.manage"],
  Rewards_Management: ["rewards.manage","rewards.review"],
};

export default command(
  new SlashCommandBuilder()
    .setName("team")
    .setDescription("Manage internal staff permissions")
    .addSubcommand((s) => s.setName("add").setDescription("Add staff").addUserOption((o) => o.setName("member").setDescription("Staff member").setRequired(true)).addStringOption((o) => o.setName("group").setDescription("Permission group").setRequired(true).addChoices(...groups.map((x) => ({ name: x, value: x })))))
    .addSubcommand((s) => s.setName("remove").setDescription("Remove staff access").addUserOption((o) => o.setName("member").setDescription("Staff member").setRequired(true)))
    .addSubcommand((s) => s.setName("list").setDescription("List staff")),
  async (i) => {
    requirePerm(i, "team.manage");
    const guild = getGuild(i.guildId);
    const sub = i.options.getSubcommand();
    const isOwner = guild.team.some((member) => member.discordId === i.user.id && member.status === "ACTIVE" && member.group === "Owner");

    if (sub === "list") {
      const members = process.env.OVERLAND_STORAGE === "mysql" ? await listTeam(i.guildId) : guild.team;
      return reply(i, "Internal team", members.filter((member) => member.status === "ACTIVE").map((member) => "<@" + member.discordId + "> • " + (member.group?.name || member.group) + " • " + (member.group?.permissions || member.permissions || []).join(", ")).join("\n") || "No staff.");
    }

    const user = i.options.getUser("member", true);
    if (process.env.OVERLAND_STORAGE === "mysql") {
      if (sub === "remove") {
        const members = await listTeam(i.guildId);
        const target = members.find((member) => member.discordId === user.id);
        if (!target || target.status !== "ACTIVE") throw new Error("That member is not active staff.");
        await removeTeamMember(i.guildId, target.id, isOwner);
        await appendAuditLog(i.guildId, { actorId: i.user.id, action: "team.remove", entityType: "InternalTeamMember", entityId: target.id, details: { discordId: user.id } });
      } else {
        const groupName = i.options.getString("group", true);
        if (groupName === "Owner" && !isOwner) throw new Error("Only an existing Owner can appoint another Owner.");
        await addTeamMember(i.guildId, {
          discordId: user.id,
          username: user.username,
          groupName,
          publicRole: groupName === "Owner" ? "Founder" : groupName,
          jobTitle: groupName === "Owner" ? "Owner" : groupName,
          department: groupName,
          responsibilities: null,
        });
        await appendAuditLog(i.guildId, { actorId: i.user.id, action: "team.add", entityType: "InternalTeamMember", entityId: user.id, details: { groupName } });
      }
      await syncTeamCacheFromMySQL(i.guildId);
    } else {
      if (sub === "remove") {
        const member = guild.team.find((x) => x.discordId === user.id);
        if (member) member.status = "REMOVED";
      } else {
        const group = i.options.getString("group", true);
        if (group === "Owner" && !isOwner) throw new Error("Only an existing Owner can appoint another Owner.");
        guild.team = guild.team.filter((x) => x.discordId !== user.id);
        guild.team.push({ discordId: user.id, username: user.username, group, permissions: map[group], status: "ACTIVE", addedBy: i.user.id, addedAt: new Date().toISOString() });
      }
      await saveStore();
    }
    await reply(i, "Team updated", user.tag + " • " + sub);
  },
);
