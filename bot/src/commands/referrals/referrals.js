import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { referralStats } from "../../services/referrals.js";
export default command(
  new SlashCommandBuilder().setName("referrals").setDescription("View your referral stats"),
  async (i) => {
    const stats = await referralStats(i.guildId, i.user.id);
    await reply(i, "Your referrals", "Invited: " + stats.total + "\nVerified: " + stats.verified + "\nRetained: " + stats.retained);
  },
);
