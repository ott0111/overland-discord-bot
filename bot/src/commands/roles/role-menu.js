import { SlashCommandBuilder, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder } from "discord.js";
import { command, reply, requirePerm, embed } from "../helpers.js";
import { getGuild, saveStore } from "../../store.js";
export default command(new SlashCommandBuilder().setName("role-menu").setDescription("Publish a self-assignable role panel")
 .addChannelOption(o=>o.setName("channel").setDescription("Panel channel").addChannelTypes(ChannelType.GuildText).setRequired(true))
 .addRoleOption(o=>o.setName("role1").setDescription("First self-assignable role").setRequired(true))
 .addRoleOption(o=>o.setName("role2").setDescription("Second self-assignable role"))
 .addRoleOption(o=>o.setName("role3").setDescription("Third self-assignable role"))
 .addRoleOption(o=>o.setName("role4").setDescription("Fourth self-assignable role"))
 .addRoleOption(o=>o.setName("role5").setDescription("Fifth self-assignable role"))
 .addStringOption(o=>o.setName("style").setDescription("Button or dropdown menu").addChoices({name:"Buttons",value:"buttons"},{name:"Dropdown",value:"dropdown"})),
 async i=>{requirePerm(i,"config.manage");const channel=i.options.getChannel("channel",true),roles=[1,2,3,4,5].map(n=>i.options.getRole("role"+n)).filter(Boolean),style=i.options.getString("style")||"buttons";
 for(const role of roles)if(role.managed||role.permissions.has(8n)||role.position>=i.guild.members.me.roles.highest.position)throw new Error("Role "+role.name+" cannot be self-assigned because it is managed, privileged, or above the bot.");
 const card=embed("CHOOSE YOUR ROLES","Select the roles that match your interests. You can update your selections later.\n\nThese roles are for community preferences only and do not grant internal Overland staff permissions.");
 if(style==="dropdown"){const menu=new StringSelectMenuBuilder().setCustomId("overland:role:select").setPlaceholder("Select your community roles").setMinValues(0).setMaxValues(roles.length).addOptions(roles.map(r=>({label:r.name.slice(0,100),value:r.id,description:"Add or remove "+r.name.slice(0,70)})));const message=await channel.send({embeds:[card],components:[new ActionRowBuilder().addComponents(menu)]});const g=getGuild(i.guildId);g.settings.roleMenus||={};g.settings.roleMenus[message.id]=roles.map(r=>r.id);await saveStore();}
 else{const rows=[];for(let n=0;n<roles.length;n+=5)rows.push(new ActionRowBuilder().addComponents(...roles.slice(n,n+5).map(r=>new ButtonBuilder().setCustomId("overland:role:toggle:"+r.id).setLabel(r.name.slice(0,80)).setStyle(ButtonStyle.Secondary))));await channel.send({embeds:[card],components:rows});}
 return reply(i,"ROLE MENU PUBLISHED","Your "+style+" role panel is live in "+channel+".");}
);
