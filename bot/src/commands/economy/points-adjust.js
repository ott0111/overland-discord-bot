import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync, syncMemberProgression } from "../helpers.js";
import { award } from "../../services/economy.js";

export default command(
  new SlashCommandBuilder().setName("points-adjust").setDescription("Award points to a member")
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("currency").setDescription("Currency").setRequired(true)
      .addChoices({ name: "Overpoints", value: "OVERPOINTS" }, { name: "Overcredits", value: "OVERCREDITS" }))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setMaxValue(10000).setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Reason").setRequired(true)),
  async (i) => {
    await requirePermAsync(i, "economy.manage");
    const user = i.options.getUser("member", true);
    const amount = i.options.getInteger("amount", true);
    await award(i.guildId, user, {
      currency: i.options.getString("currency", true), amount, source: "ADMIN_ADJUSTMENT",
      reason: i.options.getString("reason", true), actorId: i.user.id, idempotencyKey: "admin:" + i.id,
    });
    const earned = await syncMemberProgression(i, user);
    await reply(i, "Points awarded", "Awarded " + amount + " to " + user.tag + "." + (earned.length ? "\nRoles unlocked: " + earned.join(", ") : ""));
  },
);
