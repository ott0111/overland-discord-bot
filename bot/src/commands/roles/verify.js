import { SlashCommandBuilder } from "discord.js";
import { command, embed } from "../helpers.js";
import { getGuild, getMember, saveStore } from "../../store.js";
import { getMemberVerification, saveVerificationChallenge } from "../../db/repositories/roles.js";

export default command(
  new SlashCommandBuilder().setName("verify").setDescription("Start your Overland verification challenge"),
  async (i) => {
    const guild = getGuild(i.guildId);
    const legacyMember = getMember(i.guildId, i.user);
    const mysqlMode = process.env.OVERLAND_STORAGE === "mysql";
    const state = mysqlMode ? await getMemberVerification(i.guildId, i.user) : null;
    const rulesAccepted = state ? Boolean(state.profile?.rulesAcceptedAt) : Boolean(legacyMember.rulesAcceptedAt);
    const suspicious = state ? state.isSuspicious : Boolean(legacyMember.suspicious);
    const verifiedAt = state?.verifiedAt || legacyMember.verifiedAt;
    if (!guild.settings.verification.enabled) throw new Error("Verification is currently disabled.");
    if (!rulesAccepted) throw new Error("Read and accept the server rules with /rules first.");
    if (guild.blacklist.some((x) => x.userId === i.user.id)) throw new Error("Your account is flagged on the Overland participation blacklist. Contact staff.");
    if (suspicious) throw new Error("Your account requires manual review by staff.");
    if (verifiedAt) throw new Error("You are already verified.");
    const age = (Date.now() - i.user.createdTimestamp) / 86400000;
    if (age < guild.settings.verification.minAccountAgeDays) throw new Error("Your Discord account must be at least " + guild.settings.verification.minAccountAgeDays + " days old.");
    if (guild.settings.verification.requireAvatar && !i.user.avatar) throw new Error("Please set a Discord avatar before verifying.");
    const a = Math.floor(Math.random() * 8) + 2;
    const b = Math.floor(Math.random() * 8) + 2;
    const challenge = { answer: a + b, expiresAt: Date.now() + 600000, attempts: 0 };
    if (mysqlMode) await saveVerificationChallenge(i.guildId, i.user, challenge);
    else { legacyMember.verification = challenge; await saveStore(); }
    return i.reply({
      embeds: [embed("OVERLAND VERIFICATION", "Solve the challenge below, then submit it using **/verify-answer**.\n\n**" + a + " + " + b + " = ?**\n\nThis challenge expires in 10 minutes.")],
      ephemeral: true,
    });
  },
);
