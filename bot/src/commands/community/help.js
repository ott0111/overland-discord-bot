import {SlashCommandBuilder} from "discord.js";import {command,embed} from "../helpers.js";
export default command(new SlashCommandBuilder().setName("help").setDescription("Browse Overland Core commands"),async i=>{const e=embed("OVERLAND CORE  /  COMMAND DIRECTORY","Your command reference for the Overland community.").addFields(
{name:"COMMUNITY",value:"/profile · /daily · /leaderboard · /invite · /referrals · /rewards · /campaigns · /submit · /socials · /poll",inline:false},
{name:"SUPPORT",value:"/ticket open · /ticket close · /ticket claim · /ticket add · /ticket remove · /ticket rename · /ticket transcript · /ticket status",inline:false},
{name:"MODERATION",value:"/ban · /unban · /kick · /timeout · /mute · /untimeout · /warn · /warnings · /purge · /clear · /slowmode · /lock · /unlock · /modlogs · /case · /nickname",inline:false},
{name:"UTILITY",value:"/ping · /serverinfo · /userinfo · /avatar · /banner · /servericon · /serverbanner · /membercount · /roleinfo · /channelinfo · /botinfo · /uptime · /permissions",inline:false},
{name:"ADMINISTRATION",value:"/ticket-setup · /autorole · /modlog · /team · /analytics · /x-setup · /x-announce",inline:false},
{name:"NOTE",value:"Some staff commands require Discord permissions or an assigned internal Overland permission group.",inline:false});return i.reply({embeds:[e],ephemeral:true});});