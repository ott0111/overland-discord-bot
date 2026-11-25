import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { campaignDetails } from "../../services/campaigns.js";

export default command(
  new SlashCommandBuilder().setName("campaign-info").setDescription("View campaign details")
    .addStringOption((o) => o.setName("campaign_id").setDescription("Campaign ID").setRequired(true)),
  async (i) => {
    const campaign = await campaignDetails(i.guildId, i.options.getString("campaign_id", true));
    if (!campaign) throw new Error("Campaign not found.");
    await reply(i, campaign.name, campaign.description + "\nStatus: " + campaign.status +
      "\nEnds: " + new Date(campaign.endsAt).toLocaleString() + "\nReward: " + campaign.pointReward + " Overpoints", false);
  },
);
