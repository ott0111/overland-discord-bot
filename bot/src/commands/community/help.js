import {SlashCommandBuilder} from "discord.js";import {command,embed} from "../helpers.js";
export default command(new SlashCommandBuilder().setName("help").setDescription("Browse Overland Core commands"),async i=>{
const e=embed("OVERLAND CORE  /  COMMAND DIRECTORY","Community operations, support and administration.").addFields(
{name:"MEMBERS",value:"/profile · /verify · /daily · /leaderboard · /invite · /referrals · /rewards · /campaigns · /submit · /socials · /community rep · /community vouch",inline:false},
{name:"COMMUNITY",value:"/community suggest · /community report · /community appeal · /poll · /reminder · /role-menu · /roles · /interests",inline:false},
{name:"SUPPORT",value:"/ticket open · /ticket close · /ticket claim · /ticket add · /ticket remove · /ticket rename · /ticket transcript · /ticket status · /ticket-setup",inline:false},
{name:"MODERATION",value:"/ban · /unban · /kick · /timeout · /mute · /untimeout · /warn · /warnings · /purge · /clear · /slowmode · /lock · /unlock · /lockdown · /modlogs · /case · /nickname · /security",inline:false},
{name:"MEMBER SECURITY",value:"/member-admin checkuser · /member-admin blacklist · /member-admin unblacklist · /member-admin unverify · /security altcheck · /security captcha · /verify-panel",inline:false},
{name:"STAFF & SETUP",value:"/staff stats · /staff claims · /staff activity · /staff note-add · /setup · /autorole · /modlog · /team · /analytics · /role-temp · /voice",inline:false},
{name:"UTILITY",value:"/ping · /serverinfo · /userinfo · /avatar · /banner · /servericon · /serverbanner · /membercount · /roleinfo · /channelinfo · /botinfo · /uptime · /permissions",inline:false},
{name:"ACCESS",value:"Staff commands require the appropriate Discord permission and/or an assigned internal Overland permission group. Public roles do not grant staff access.",inline:false});
return i.reply({embeds:[e],ephemeral:true});});
