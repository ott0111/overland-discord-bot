import {SlashCommandBuilder} from "discord.js";
import {command,reply,requirePerm,embed} from "../helpers.js";
import {getGuild,saveStore} from "../../store.js";
export default command(new SlashCommandBuilder().setName("staff").setDescription("Internal staff operations")
.addSubcommand(s=>s.setName("stats").setDescription("View ticket workload by staff"))
.addSubcommand(s=>s.setName("claims").setDescription("View tickets claimed by staff"))
.addSubcommand(s=>s.setName("activity").setDescription("View recent staff actions"))
.addSubcommand(s=>s.setName("note-add").setDescription("Add a private staff note").addUserOption(o=>o.setName("member").setDescription("Member").setRequired(true)).addStringOption(o=>o.setName("note").setDescription("Internal note").setRequired(true).setMaxLength(1000)))
.addSubcommand(s=>s.setName("notes").setDescription("View private staff notes").addUserOption(o=>o.setName("member").setDescription("Member").setRequired(true))),
async i=>{requirePerm(i,"team.manage");const g=getGuild(i.guildId),sub=i.options.getSubcommand();
if(sub==="stats"||sub==="claims"){const counts=new Map();for(const t of g.tickets)if(t.claimedBy)counts.set(t.claimedBy,(counts.get(t.claimedBy)||0)+1);const lines=[...counts.entries()].sort((a,b)=>b[1]-a[1]).slice(0,15).map(([id,n])=>"<@"+id+"> · **"+n+"** tickets");return i.reply({embeds:[embed("STAFF WORKLOAD",lines.join("\n")||"No claimed tickets recorded.")],ephemeral:true});}
if(sub==="activity"){const lines=(g.audit||[]).slice(0,15).map(x=>"<t:"+Math.floor(new Date(x.at).getTime()/1000)+":R> · **"+x.action+"** · <@"+x.actorId+">");return i.reply({embeds:[embed("RECENT STAFF ACTIVITY",lines.join("\n")||"No staff activity recorded.")],ephemeral:true});}
const user=i.options.getUser("member",true);g.staffNotes||=[];
if(sub==="note-add"){g.staffNotes.unshift({id:"N-"+Date.now().toString(36),userId:user.id,authorId:i.user.id,text:i.options.getString("note",true),at:new Date().toISOString()});await saveStore();return reply(i,"Private note saved","Internal note stored for "+user.tag+".");}
const notes=g.staffNotes.filter(n=>n.userId===user.id).slice(0,10);return i.reply({embeds:[embed("INTERNAL STAFF NOTES  /  "+user.tag,notes.map(n=>"<t:"+Math.floor(new Date(n.at).getTime()/1000)+":d> · "+n.text+" · by <@"+n.authorId+">").join("\n")||"No private notes recorded.")],ephemeral:true});});
