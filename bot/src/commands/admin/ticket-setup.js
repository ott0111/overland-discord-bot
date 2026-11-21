import { SlashCommandBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { command, reply, requirePerm, embed } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";

export default command(
  new SlashCommandBuilder()
    .setName("ticket-setup")
    .setDescription("Configure and publish the Overland support panel")
    .addChannelOption(o => o.setName("channel").setDescription("Where the support panel should be posted").addChannelTypes(ChannelType.GuildText).setRequired(true))
    .addChannelOption(o => o.setName("category").setDescription("Parent category for open tickets").addChannelTypes(ChannelType.GuildCategory))
    .addRoleOption(o => o.setName("support-role").setDescription("Role that can view and answer tickets"))
    .addChannelOption(o => o.setName("archive-category").setDescription("Optional category for closed tickets").addChannelTypes(ChannelType.GuildCategory)),
  async i => {
    requirePerm(i, "config.manage");
    const g = getGuild(i.guildId), panelChannel = i.options.getChannel("channel", true);
    g.settings.ticketCategoryId = i.options.getChannel("category")?.id || null;
    g.settings.ticketSupportRoleId = i.options.getRole("support-role")?.id || null;
    g.settings.ticketPanelChannelId = panelChannel.id;
    g.settings.ticketArchiveCategoryId = i.options.getChannel("archive-category")?.id || null;
    await saveStore();

    const panel = embed("OVERLAND SUPPORT", "A dedicated support desk for the Overland community.\n\nChoose the right category when opening your ticket. Our team will review your request and respond in your private channel.")
      .addFields(
        { name: "GENERAL SUPPORT", value: "Questions, account help, and community assistance.", inline: true },
        { name: "REPORTS", value: "Report a concern or bring an issue to the team's attention.", inline: true },
        { name: "PARTNERSHIPS", value: "Business inquiries and collaboration requests.", inline: true },
        { name: "APPLICATIONS", value: "Applications and opportunities within Overland.", inline: true },
        { name: "Before you open a ticket", value: "Please include useful context and avoid duplicate requests. Never share passwords, seed phrases, private keys, or authentication codes.", inline: false }
      )
      .setThumbnail(process.env.OVERLAND_ICON_URL || i.client.user.displayAvatarURL());
    await panelChannel.send({
      embeds: [panel],
      components: [new ActionRowBuilder().addComponents(
        new ButtonBuilder().setCustomId("overland:ticket:create").setLabel("Open support ticket").setStyle(ButtonStyle.Success)
      )]
    });
    await reply(i, "Support panel published", "The Overland support panel is live in " + panelChannel + ". Ticket channels will be private and can be archived when closed.");
  }
);
