import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { activeCampaigns } from "../../services/campaigns.js";

export default command(
  new SlashCommandBuilder().setName("campaigns").setDescription("Browse active campaigns"),
  async (i) => {
    const campaigns = await activeCampaigns(i.guildId);
    await reply(i, "Active campaigns", campaigns.map((campaign) =>
      campaign.name + " • ID: " + campaign.id + "\n" + campaign.description + "\nEnds: " +
      new Date(campaign.endsAt).toLocaleDateString() + " • " + campaign.pointReward + " points"
    ).join("\n\n") || "No active campaigns.");
  },
);
