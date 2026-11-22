import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePerm } from "../helpers.js";
import { getGuild, getMember, saveStore } from "../../store.js";
import { revokeRole, syncDiscordRole } from "../../services/roles.js";
import { resetMemberVerification } from "../../db/repositories/roles.js";

export default command(
  new SlashCommandBuilder().setName("unverify").setDescription("Reset a member's Overland verification")
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true)),
  async (i) => {
    requirePerm(i, "roles.manage");
    const user = i.options.getUser("member", true);
    const discordMember = await i.guild.members.fetch(user.id).catch(() => null);
    let removed;
    if (process.env.OVERLAND_STORAGE === "mysql") {
      await resetMemberVerification(i.guildId, user);
      removed = await revokeRole(i.guildId, user.id, "Citizen", i.user.id, "Overland verification reset");
    } else {
      const guild = getGuild(i.guildId);
      const profile = getMember(i.guildId, user);
      profile.verifiedAt = null;
      profile.verification = null;
      removed = ["Citizen", "Comrade"].filter((name) => profile.roles.includes(name));
      profile.roles = (profile.roles || []).filter((name) => !removed.includes(name));
      for (const name of removed) guild.roleHistory.unshift({ id: crypto.randomUUID(), memberId: profile.id, role: name, action: "REVOKED", actorId: i.user.id, reason: "Overland verification reset", at: new Date().toISOString() });
      await saveStore();
    }
    if (discordMember) {
      for (const role of removed) await syncDiscordRole(getGuild(i.guildId), discordMember, role, false).catch(() => {});
    }
    await reply(i, "VERIFICATION RESET", user.tag + " must complete the Overland verification process again.");
  },
);
