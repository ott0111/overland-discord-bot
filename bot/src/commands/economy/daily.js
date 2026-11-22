import { SlashCommandBuilder } from "discord.js";
import { command, reply, syncMemberProgression } from "../helpers.js";
import { dailyCheckin } from "../../services/economy.js";
import { checkAchievements } from "../../services/achievements.js";

export default command(
  new SlashCommandBuilder().setName("daily").setDescription("Claim daily points and streak bonus"),
  async (i) => {
    const result = await dailyCheckin(i.guildId, i.user);
    const rolesBefore = await syncMemberProgression(i, i.user);
    const achievements = await checkAchievements(i.guildId, i.user);
    const rolesAfter = achievements.length ? await syncMemberProgression(i, i.user) : [];
    const roles = [...new Set([...rolesBefore, ...rolesAfter])];
    await reply(
      i,
      "Daily check-in",
      "+" + result.points + " Overpoints • +" + result.bonus + " Overcredits\nStreak: " + result.streak + " days" +
        (roles.length ? "\nRoles: " + roles.join(", ") : "") +
        (achievements.length ? "\nAchievements: " + achievements.join(", ") : ""),
    );
  },
);
