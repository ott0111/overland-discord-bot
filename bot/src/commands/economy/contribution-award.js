import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync, syncMemberProgression } from "../helpers.js";
import { award } from "../../services/economy.js";

export default command(
  new SlashCommandBuilder().setName("contribution-award").setDescription("Reward a community contribution")
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Points").setMinValue(1).setMaxValue(100).setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Contribution details").setRequired(true)),
  async (i) => {
    await requirePermAsync(i, "economy.manage");
    const user = i.options.getUser("member", true);
    await award(i.guildId, user, {
      amount: i.options.getInteger("amount", true), category: "contribution", source: "CONTRIBUTION",
      reason: i.options.getString("reason", true), actorId: i.user.id, idempotencyKey: "contribution:" + i.id,
    });
    const earned = await syncMemberProgression(i, user);
    await reply(i, "Contribution rewarded", user.tag + " received the award." + (earned.length ? "\nRoles unlocked: " + earned.join(", ") : ""));
  },
);
