import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { submitWork, CATEGORIES } from "../../services/campaigns.js";

export default command(
  new SlashCommandBuilder().setName("submit").setDescription("Submit work to a campaign")
    .addStringOption((o) => o.setName("campaign_id").setDescription("Campaign ID").setRequired(true))
    .addStringOption((o) => o.setName("category").setDescription("Category").setRequired(true)
      .addChoices(...CATEGORIES.map((category) => ({ name: category.replaceAll("_", " "), value: category }))))
    .addStringOption((o) => o.setName("link").setDescription("HTTPS URL").setRequired(true))
    .addStringOption((o) => o.setName("description").setDescription("Work description").setRequired(true)),
  async (i) => {
    const submission = await submitWork(i.guildId, i.user, {
      campaignId: i.options.getString("campaign_id", true), category: i.options.getString("category", true),
      linkUrl: i.options.getString("link", true), content: i.options.getString("description", true),
    });
    await reply(i, "Submission received", "Pending review. ID: " + submission.id);
  },
);
