import { ChannelType, EmbedBuilder, SlashCommandBuilder } from "discord.js";
import { command, requirePermAsync, reply, BRAND } from "../helpers.js";
import { listRoles, getRoleGuideConfig, saveRoleGuideConfig } from "../../db/repositories/roles.js";

function clipped(value, max = 1000) {
  const text = String(value || "").trim();
  return text.length > max ? text.slice(0, max - 1) + "…" : text;
}

function requirementLines(role) {
  const lines = [];
  if (role.minOverpoints !== null) lines.push("**Minimum:** " + Number(role.minOverpoints).toLocaleString() + " Overpoints");
  if (role.requiresRole?.name) lines.push("**Prerequisite:** " + role.requiresRole.name);
  const config = role.config || {};
  if (config.requireVerified) lines.push("**Condition:** complete Overland verification.");
  if (config.requireXFollow) lines.push("**Condition:** X follow status must be verified.");
  const progression = config.progression || {};
  if (progression.kind === "approved_submission_count") {
    const categories = Array.isArray(progression.categories) ? progression.categories.join(", ") : "configured submission categories";
    lines.push("**Progression:** " + Number(progression.minimum || 0) + " approved submissions across: " + clipped(categories, 250) + ".");
  }
  if (config.guideInstructions) lines.push(clipped(config.guideInstructions, 700));
  if (Array.isArray(config.requirements)) {
    for (const item of config.requirements.slice(0, 5)) {
      if (typeof item === "string") lines.push("• " + clipped(item, 180));
      else if (item && typeof item === "object") {
        const label = clipped(item.label || item.name || item.category || "Requirement", 80);
        const detail = clipped(item.description || item.instructions || "", 180);
        const amount = Number.isSafeInteger(item.minimum) ? " • " + item.minimum.toLocaleString() : "";
        const channel = /^\d{17,20}$/.test(String(item.channelId || "")) ? " in <#" + item.channelId + ">" : "";
        lines.push("• **" + label + "**" + amount + channel + (detail ? " • " + detail : ""));
      }
    }
  }
  if (!lines.length) lines.push("Requirements have not been configured yet.");
  return lines.join("\n");
}

async function buildGuideEmbeds(guild, roles) {
  const visible = roles.filter((role) => !role.isInternal && role.config?.showInGuide !== false);
  if (!visible.length) throw new Error("There are no public roles configured to show in the guide.");
  const resolved = [];
  const warnings = [];
  for (const role of visible) {
    let label = "**" + role.name + "**";
    if (role.discordRoleId) {
      const discordRole = await guild.roles.fetch(role.discordRoleId).catch(() => null);
      if (discordRole) label = discordRole.toString();
      else warnings.push(role.name + ": configured Discord role could not be found");
    } else warnings.push(role.name + ": no Discord role ID is configured");
    resolved.push({ ...role, label });
  }

  const intro = new EmbedBuilder()
    .setColor(BRAND.primary)
    .setAuthor({ name: "OVERLAND FINANCE" })
    .setTitle("ROLES & OVERPOINTS")
    .setDescription("Get involved in Overland, earn Overpoints, and unlock community roles. Your current role requirements and earning instructions are listed below.")
    .setFooter({ text: "OVERLAND FINANCE  •  COMMUNITY" })
    .setTimestamp();

  const embeds = [intro];
  for (let offset = 0; offset < resolved.length; offset += 4) {
    const chunk = resolved.slice(offset, offset + 4);
    const page = new EmbedBuilder()
      .setColor(BRAND.primary)
      .setTitle(offset === 0 ? "PUBLIC ROLE PROGRESSION" : "PUBLIC ROLE PROGRESSION  •  CONTINUED")
      .setFooter({ text: "OVERLAND FINANCE  •  ROLE REQUIREMENTS" })
      .setTimestamp();
    for (const role of chunk) {
      const description = clipped(role.description, 300);
      const value = [description, requirementLines(role)].filter(Boolean).join("\n\n");
      page.addFields({ name: clipped(role.label + "  •  " + role.name, 256), value: clipped(value, 1024), inline: false });
    }
    embeds.push(page);
  }
  return { embeds, warnings };
}

export default command(
  new SlashCommandBuilder()
    .setName("role-guide")
    .setDescription("Publish or refresh the public Overland roles and points guide")
    .addChannelOption((option) => option.setName("channel").setDescription("Channel for the public guide").addChannelTypes(ChannelType.GuildText).setRequired(true)),
  async (i) => {
    await requirePermAsync(i, "roles.manage");
    if (process.env.OVERLAND_STORAGE !== "mysql") throw new Error("The role guide requires MySQL mode. Do not switch production storage until migration is approved.");
    await i.deferReply({ ephemeral: true });
    const channel = i.options.getChannel("channel", true);
    const roles = await listRoles(i.guildId);
    const { embeds, warnings } = await buildGuideEmbeds(i.guild, roles);
    const previous = await getRoleGuideConfig(i.guildId);
    const previousIds = previous.channelId === channel.id && Array.isArray(previous.messageIds) ? previous.messageIds : [];
    const nextIds = [];

    for (let index = 0; index < embeds.length; index++) {
      const oldId = previousIds[index];
      const oldMessage = oldId ? await channel.messages.fetch(oldId).catch(() => null) : null;
      if (oldMessage) {
        await oldMessage.edit({ embeds: [embeds[index]] });
        nextIds.push(oldMessage.id);
      } else {
        const message = await channel.send({ embeds: [embeds[index]] });
        nextIds.push(message.id);
      }
    }

    for (const staleId of previousIds.slice(embeds.length)) {
      const stale = await channel.messages.fetch(staleId).catch(() => null);
      if (stale) await stale.delete().catch(() => {});
    }

    await saveRoleGuideConfig(i.guildId, { channelId: channel.id, messageIds: nextIds, updatedAt: new Date().toISOString() }, i.user.id);
    const warningText = warnings.length ? "\n\n**Needs attention:**\n" + warnings.slice(0, 8).map((x) => "• " + x).join("\n") : "";
    await reply(i, "Role guide published", "The public guide is live in " + channel + ". " + nextIds.length + " embed message(s) were created or refreshed." + warningText);
  },
);
