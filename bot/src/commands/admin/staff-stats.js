import { SlashCommandBuilder } from "discord.js";
import { command, reply, requirePerm } from "../helpers.js";
import { getGuild } from "../../store.js";
export default command(new SlashCommandBuilder().setName("staff-stats").setDescription("View ticket workload and customer satisfaction by staff member"),
 async i=>{requirePerm(i,"team.manage");const g=getGuild(i.guildId),rows=new Map();for(const t of g.tickets){if(!t.claimedBy)continue;const x=rows.get(t.claimedBy)||{claimed:0,closed:0,rating:0,ratings:0};x.claimed++;if(t.status==="CLOSED")x.closed++;if(t.feedback?.rating){x.rating+=t.feedback.rating;x.ratings++;}rows.set(t.claimedBy,x);}const body=[...rows].sort((a,b)=>b[1].claimed-a[1].claimed).slice(0,15).map(([id,x])=>"<@"+id+"> • "+x.claimed+" claimed • "+x.closed+" closed • "+(x.ratings?(x.rating/x.ratings).toFixed(1)+"/5":"No ratings")).join("\n")||"No ticket claims recorded yet.";return reply(i,"STAFF PERFORMANCE",body);}
);