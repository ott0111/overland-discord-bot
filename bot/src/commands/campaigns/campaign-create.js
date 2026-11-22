import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync } from "../helpers.js";
import { createCampaign } from "../../services/campaigns.js";

export default command(
  new SlashCommandBuilder().setName("campaign-create").setDescription("Create a campaign")
    .addStringOption((o) => o.setName("name").setDescription("Name").setRequired(true))
    .addStringOption((o) => o.setName("description").setDescription("Brief").setRequired(true))
    .addIntegerOption((o) => o.setName("days").setDescription("Duration days").setMinValue(1).setMaxValue(90).setRequired(true))
    .addIntegerOption((o) => o.setName("points").setDescription("Base reward").setMinValue(0).setMaxValue(100).setRequired(true)),
  async (i) => {
    await requirePermAsync(i, "campaigns.manage");
    const days = i.options.getInteger("days", true);
    const campaign = await createCampaign(i.guildId, {
      name: i.options.getString("name", true), description: i.options.getString("description", true),
      startsAt: new Date().toISOString(), endsAt: new Date(Date.now() + days * 86400000).toISOString(),
      pointReward: i.options.getInteger("points", true), status: "ACTIVE",
    }, i.user.id);
    await reply(i, "Campaign published", campaign.name + " • " + campaign.id);
  },
);
