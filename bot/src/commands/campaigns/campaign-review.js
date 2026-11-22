import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePermAsync, syncMemberProgression } from "../helpers.js";
import { reviewSubmission } from "../../services/campaigns.js";

export default command(
  new SlashCommandBuilder().setName("campaign-review").setDescription("Review a submission")
    .addStringOption((o) => o.setName("submission_id").setDescription("Submission ID").setRequired(true))
    .addBooleanOption((o) => o.setName("approve").setDescription("Approve").setRequired(true))
    .addStringOption((o) => o.setName("feedback").setDescription("Feedback")),
  async (i) => {
    await requirePermAsync(i, "campaigns.review");
    const submission = await reviewSubmission(
      i.guildId, i.options.getString("submission_id", true), i.options.getBoolean("approve", true),
      i.user.id, i.options.getString("feedback") || "",
    );
    await syncMemberProgression(i, { id: submission.memberId, username: submission.username });
    await reply(i, "Submission " + submission.status.toLowerCase(), submission.username + " • " + submission.pointsAwarded + " Overpoints");
  },
);
