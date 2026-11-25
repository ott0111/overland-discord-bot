import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { mySubmissions } from "../../services/campaigns.js";

export default command(
  new SlashCommandBuilder().setName("my-submissions").setDescription("View your campaign submissions"),
  async (i) => {
    const rows = await mySubmissions(i.guildId, i.user.id);
    await reply(i, "Your submissions", rows.map((row) =>
      row.category + " • " + row.status + " • " + row.id + "\n" + row.content +
      (row.feedback ? "\nFeedback: " + row.feedback : "")
    ).join("\n\n") || "You have not submitted anything yet.");
  },
);
