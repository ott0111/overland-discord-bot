import { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { command, embed } from "../helpers.js";
import { getGuild, getMember } from "../../store.js";
import { getMemberVerification } from "../../db/repositories/roles.js";

export default command(
  new SlashCommandBuilder().setName("rules").setDescription("Read and accept the Overland community rules"),
  async (i) => {
    const guild = getGuild(i.guildId);
    const legacyMember = getMember(i.guildId, i.user);
    const state = process.env.OVERLAND_STORAGE === "mysql" ? await getMemberVerification(i.guildId, i.user) : null;
    const accepted = state ? Boolean(state.profile?.rulesAcceptedAt) : Boolean(legacyMember.rulesAcceptedAt);
    const rules = guild.settings.info.rules || [
      "1. Treat community members with respect.",
      "2. No spam, scams, phishing, or malicious links.",
      "3. Keep discussions relevant and use the correct channels.",
      "4. Never share private keys, seed phrases, passwords, or authentication codes.",
      "5. Follow Discord's Terms and Community Guidelines.",
      "6. Follow staff instructions and use tickets for support.",
    ].join("\n");
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("overland:rules:accept").setLabel(accepted ? "Rules already accepted" : "I agree to the rules")
        .setStyle(ButtonStyle.Success).setDisabled(accepted),
    );
    return i.reply({ embeds: [embed("OVERLAND COMMUNITY RULES", rules)], components: [row], ephemeral: true });
  },
);
