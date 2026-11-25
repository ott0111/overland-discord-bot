import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync, syncMemberProgression } from "../helpers.js";
import { getMember, getGuild, saveStore } from "../../store.js";
import { grantRole, syncDiscordRole } from "../../services/roles.js";
import { completeMemberVerification } from "../../db/repositories/roles.js";

export default command(
  new SlashCommandBuilder().setName("verify-user").setDescription("Manually verify a member as Citizen")
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason")),
  async (i) => {
    await requirePermAsync(i, "roles.manage");
    const user = i.options.getUser("member", true);
    if (process.env.OVERLAND_STORAGE === "mysql") await completeMemberVerification(i.guildId, user);
    else {
      const member = getMember(i.guildId, user);
      member.verifiedAt = new Date().toISOString();
      member.suspicious = false;
      await saveStore();
    }
    await grantRole(i.guildId, user, "Citizen", i.user.id, i.options.getString("reason") || "Staff verification");
    const discordMember = await i.guild.members.fetch(user.id);
    await syncDiscordRole(getGuild(i.guildId), discordMember, "Citizen", true).catch(() => {});
    await syncMemberProgression(i, user);
    await reply(i, "Member verified", user.tag + " is now a Citizen.");
  },
);
