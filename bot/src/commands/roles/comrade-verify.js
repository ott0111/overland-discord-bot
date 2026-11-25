import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync, syncMemberProgression } from "../helpers.js";
import { getMember, saveStore, getGuild } from "../../store.js";
import { grantRole, revokeRole, syncDiscordRole } from "../../services/roles.js";
import { setMemberXFollow } from "../../db/repositories/roles.js";

export default command(
  new SlashCommandBuilder().setName("comrade-verify").setDescription("Verify a member's X follow status")
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
    .addBooleanOption((o) => o.setName("following").setDescription("Confirmed following").setRequired(true)),
  async (i) => {
    await requirePermAsync(i, "roles.verify_x");
    const user = i.options.getUser("member", true);
    const following = i.options.getBoolean("following", true);
    if (process.env.OVERLAND_STORAGE === "mysql") await setMemberXFollow(i.guildId, user, following);
    else {
      getMember(i.guildId, user).xFollowVerified = following;
      await saveStore();
    }
    const discordMember = await i.guild.members.fetch(user.id);
    if (following) {
      await grantRole(i.guildId, user, "Comrade", i.user.id, "X follow verified");
      await syncDiscordRole(getGuild(i.guildId), discordMember, "Comrade", true).catch(() => {});
      await syncMemberProgression(i, user);
    } else {
      await revokeRole(i.guildId, user.id, "Comrade", i.user.id, "X follow verification removed");
      await syncDiscordRole(getGuild(i.guildId), discordMember, "Comrade", false).catch(() => {});
    }
    await reply(i, "X follow status saved", user.tag + " • " + (following ? "Verified" : "Not verified"));
  },
);
