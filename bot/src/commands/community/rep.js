import { SlashCommandBuilder } from "discord.js";
import { command, embed } from "../helpers.js";
import { getGuild } from "../../store.js";
export default command(new SlashCommandBuilder().setName("rep").setDescription("View a member's vouches and reputation")
 .addUserOption(o=>o.setName("member").setDescription("Member").setRequired(false)),
 async i=>{const g=getGuild(i.guildId),u=i.options.getUser("member")||i.user,received=g.vouches.filter(v=>v.toId===u.id),given=g.vouches.filter(v=>v.fromId===u.id);const latest=received.slice(0,5).map(v=>"• "+v.details.slice(0,120)+" ( <@"+v.fromId+"> )").join("\n")||"No vouches yet.";return i.reply({embeds:[embed("REPUTATION  /  "+u.username,"A record of community vouches and completed-service feedback.").setThumbnail(u.displayAvatarURL({size:256})).addFields({name:"VOUCHES RECEIVED",value:String(received.length),inline:true},{name:"VOUCHES GIVEN",value:String(given.length),inline:true},{name:"RECENT FEEDBACK",value:latest,inline:false})]});}
);