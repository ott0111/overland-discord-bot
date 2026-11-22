import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { getMember, saveStore, getGuild } from "../../store.js";
import { grantRole, syncDiscordRole, checkProgression } from "../../services/roles.js";
import { verifyReferral } from "../../services/referrals.js";
import { getMemberVerification, saveVerificationChallenge, completeMemberVerification } from "../../db/repositories/roles.js";

export default command(
  new SlashCommandBuilder().setName("verify-answer").setDescription("Submit your verification answer")
    .addIntegerOption((o) => o.setName("answer").setDescription("Answer shown by the verification panel").setRequired(true)),
  async (i) => {
    const guild = getGuild(i.guildId);
    const legacyMember = getMember(i.guildId, i.user);
    const mysqlMode = process.env.OVERLAND_STORAGE === "mysql";
    const state = mysqlMode ? await getMemberVerification(i.guildId, i.user) : null;
    const profile = state?.profile || {};
    const rulesAcceptedAt = profile.rulesAcceptedAt || legacyMember.rulesAcceptedAt;
    const suspicious = state ? state.isSuspicious : Boolean(legacyMember.suspicious);
    const challenge = profile.verificationChallenge || legacyMember.verification;
    if (!rulesAcceptedAt) throw new Error("Accept the server rules with /rules before verifying.");
    if (guild.blacklist.some((x) => x.userId === i.user.id)) throw new Error("Your account is on the Overland participation blacklist.");
    if (suspicious) throw new Error("Your account was flagged by anti-raid protection. Contact staff.");
    if (!challenge || Date.now() > challenge.expiresAt) throw new Error("No active challenge. Press Verify on the panel again.");
    if (i.options.getInteger("answer", true) !== challenge.answer) {
      challenge.attempts = (challenge.attempts || 0) + 1;
      if (challenge.attempts >= 3) {
        if (mysqlMode) await saveVerificationChallenge(i.guildId, i.user, null);
        else legacyMember.verification = null;
      } else if (mysqlMode) await saveVerificationChallenge(i.guildId, i.user, challenge);
      else legacyMember.verification = challenge;
      if (!mysqlMode) await saveStore();
      throw new Error(challenge.attempts >= 3 ? "Too many incorrect attempts. Start a new verification challenge." : "Incorrect answer. " + (3 - challenge.attempts) + " attempts remaining.");
    }
    if (mysqlMode) await completeMemberVerification(i.guildId, i.user);
    else {
      legacyMember.verifiedAt = new Date().toISOString();
      legacyMember.verification = null;
      await saveStore();
    }
    await grantRole(i.guildId, i.user, "Citizen", i.user.id, "Completed verification");
    const discordMember = await i.guild.members.fetch(i.user.id);
    await syncDiscordRole(getGuild(i.guildId), discordMember, "Citizen", true).catch(() => {});
    await verifyReferral(i.guildId, i.user.id);
    const earned = await checkProgression(i.guildId, i.user);
    for (const role of earned) await syncDiscordRole(getGuild(i.guildId), discordMember, role, true).catch(() => {});
    await reply(i, "Verification complete", "You are now verified as a Citizen. Welcome to Overland.");
  },
);
