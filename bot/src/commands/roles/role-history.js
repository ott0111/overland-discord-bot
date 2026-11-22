import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { getGuild } from "../../store.js";
import { listMemberRoleHistory } from "../../db/repositories/roles.js";

export default command(
  new SlashCommandBuilder().setName("role-history").setDescription("View role history")
    .addUserOption((o) => o.setName("member").setDescription("Member")),
  async (i) => {
    const user = i.options.getUser("member") || i.user;
    const rows = process.env.OVERLAND_STORAGE === "mysql"
      ? await listMemberRoleHistory(i.guildId, user.id, 10)
      : getGuild(i.guildId).roleHistory.filter((item) => item.memberId === user.id).slice(0, 10);
    const description = rows.map((item) => item.action + " " + item.role + " • " + item.reason).join("\n") || "No role history.";
    await reply(i, "Role history • " + user.username, description);
  },
);
