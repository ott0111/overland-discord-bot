import { SlashCommandBuilder } from "discord.js";
import { command, reply, syncMemberProgression } from "../helpers.js";
import { dailyCheckin } from "../../services/economy.js";
import { checkAchievements } from "../../services/achievements.js";

export default command(
  new SlashCommandBuilder().setName("daily").setDescription("Claim daily points and streak bonus"),
  async (i) => {
    const result = await dailyCheckin(i.guildId, i.user);
    const roles = await syncMemberProgression(i, i.user);
    const achievements = process.env.OVERLAND_STORAGE === "mysql" ? [] : await checkAchievements(i.guildId, i.user);
    await reply(
      i,
      "Daily check-in",
      "+" + result.points + " Overpoints • +" + result.bonus + " Overcredits\nStreak: " + result.streak + " days" +
        (roles.length ? "\nRoles: " + roles.join(", ") : "") +
        (achievements.length ? "\nAchievements: " + achievements.join(", ") : ""),
    );
  },
);
