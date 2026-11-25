import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { campaignGallery } from "../../services/campaigns.js";

export default command(
  new SlashCommandBuilder().setName("campaign-gallery").setDescription("Browse approved community submissions")
    .addStringOption((o) => o.setName("campaign_id").setDescription("Optional campaign ID")),
  async (i) => {
    const rows = await campaignGallery(i.guildId, i.options.getString("campaign_id"));
    await reply(i, "Community showcase", rows.map((row) =>
      row.username + " • " + row.category + "\n" + row.content + "\n" + row.linkUrl
    ).join("\n\n") || "No approved submissions yet.", false);
  },
);
