import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync, syncMemberProgression } from "../helpers.js";
import { award } from "../../services/economy.js";

export default command(
  new SlashCommandBuilder().setName("event-award").setDescription("Award Overpoints for event participation")
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
    .addIntegerOption((o) => o.setName("amount").setDescription("Amount").setMinValue(1).setMaxValue(100).setRequired(true))
    .addStringOption((o) => o.setName("event").setDescription("Event name").setRequired(true)),
  async (i) => {
    await requirePermAsync(i, "economy.manage");
    const user = i.options.getUser("member", true);
    const amount = i.options.getInteger("amount", true);
    await award(i.guildId, user, {
      amount, category: "community", source: "EVENT", reason: i.options.getString("event", true),
      actorId: i.user.id, idempotencyKey: "event:" + i.id,
    });
    const earned = await syncMemberProgression(i, user);
    await reply(i, "Event points awarded", user.tag + " • " + amount + " Overpoints" + (earned.length ? "\nRoles unlocked: " + earned.join(", ") : ""));
  },
);
