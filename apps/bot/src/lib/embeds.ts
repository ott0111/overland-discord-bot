
import { EmbedBuilder } from "discord.js";
import { BRAND } from "@overland/shared";
export function overlandEmbed(title: string, description?: string): EmbedBuilder {
  return new EmbedBuilder().setColor(BRAND.colors.emerald).setTitle(title).setDescription(description ?? null).setFooter({ text: "Overland Core | Overland Finance" }).setTimestamp();
}
export function errorEmbed(message: string): EmbedBuilder { return overlandEmbed("Something went wrong", message).setColor(0xe5484d); }
