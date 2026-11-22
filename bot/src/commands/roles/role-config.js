import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
import { listRoles, updateRole } from "../../db/repositories/roles.js";

export default command(
  new SlashCommandBuilder()
    .setName("role-config")
    .setDescription("Map an Overland role to a Discord role")
    .addStringOption((o) => o.setName("name").setDescription("Overland role name").setRequired(true)
      .addChoices(...["Citizen", "Comrade", "Socialite", "Creator", "Intellect", "Pioneer", "Luminary"].map((x) => ({ name: x, value: x }))))
    .addRoleOption((o) => o.setName("discord-role").setDescription("Discord role").setRequired(true)),
  async (i) => {
    await requirePermAsync(i, "roles.manage");
    const name = i.options.getString("name", true);
    const discordRole = i.options.getRole("discord-role", true);
    if (discordRole.managed || discordRole.permissions.has(8n) || discordRole.position >= i.guild.members.me.roles.highest.position) {
      throw new Error("That Discord role is managed, privileged, or positioned above the bot.");
    }
    if (process.env.OVERLAND_STORAGE === "mysql") {
      const roles = await listRoles(i.guildId);
      const role = roles.find((item) => item.name.toLowerCase() === name.toLowerCase());
      if (!role) throw new Error("Create or import the " + name + " public role in the dashboard before linking its Discord role.");
      await updateRole(i.guildId, role.id, { discordRoleId: discordRole.id });
    } else {
      getGuild(i.guildId).settings.roleIds[name] = discordRole.id;
      await saveStore();
    }
    await reply(i, "Role mapping saved", name + " now uses " + discordRole + ".");
  },
);
