import { SlashCommandBuilder } from "discord.js";
import { command, reply } from "../helpers.js";
import { createInvite, existingInvite } from "../../services/referrals.js";
export default command(new SlashCommandBuilder().setName("invite").setDescription("Get your personal referral invite"), async i => {
  const oldCode = existingInvite(i.guildId, i.user.id);
  if (oldCode) {
    const existing = await i.guild.invites.fetch(oldCode).catch(() => null);
    if (existing) return reply(i, "Your referral invite", existing.url + "\nVerified referrals earn Overpoints.");
  }
  const invite = await i.channel.createInvite({ maxAge: 0, maxUses: 0, unique: true, reason: "Referral for " + i.user.tag });
  await createInvite(i.guildId, i.user, invite);
  await reply(i, "Your referral invite", invite.url + "\nVerified referrals earn Overpoints.");
});
