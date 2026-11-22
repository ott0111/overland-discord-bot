import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync, syncMemberProgression } from "../helpers.js";
import { award } from "../../services/economy.js";
import { getGuild } from "../../store.js";
import { getNormalizedPointValue } from "../../db/repositories/economy-commands.js";

export default command(
  new SlashCommandBuilder().setName("helpful-award").setDescription("Reward a helpful community answer")
    .addUserOption((o) => o.setName("member").setDescription("Member").setRequired(true))
    .addStringOption((o) => o.setName("reason").setDescription("Why it was helpful").setRequired(true)),
  async (i) => {
    await requirePermAsync(i, "economy.manage");
    const user = i.options.getUser("member", true);
    const amount = process.env.OVERLAND_STORAGE === "mysql"
      ? await getNormalizedPointValue(i.guildId, "helpful", 5)
      : getGuild(i.guildId).settings.pointValues.helpful;
    await award(i.guildId, user, {
      amount, category: "community", source: "HELPFUL_ANSWER", reason: i.options.getString("reason", true),
      actorId: i.user.id, idempotencyKey: "helpful:" + i.id,
    });
    const earned = await syncMemberProgression(i, user);
    await reply(i, "Helpful answer rewarded", user.tag + " • " + amount + " Overpoints" + (earned.length ? "\nRoles unlocked: " + earned.join(", ") : ""));
  },
);
