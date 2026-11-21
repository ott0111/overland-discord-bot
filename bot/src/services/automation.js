import { PermissionFlagsBits } from "discord.js";
import { getGuild, getMember, saveStore } from "../store.js";
import { embed } from "../commands/helpers.js";
const windows = new Map(), voices = new Map();
export async function logEvent(guild,title,description,fields=[]){
 const g=getGuild(guild.id),id=g.settings.logChannelId||g.settings.modLogChannelId;if(!id)return;
 const ch=await guild.channels.fetch(id).catch(()=>null);if(ch?.isTextBased())await ch.send({embeds:[embed("OVERLAND LOGS  /  "+title,description).addFields(...fields.slice(0,20))]}).catch(()=>{});
}
export async function handleMessage(m){
 if(!m.guild||m.author.bot)return;const g=getGuild(m.guild.id),member=getMember(m.guild.id,m.author);g.stats.messages++;
 const ticket=g.tickets.find(t=>t.channelId===m.channel.id&&t.status==="OPEN");if(ticket)ticket.lastActivityAt=new Date().toISOString();
 const cfg=g.settings.security||{},key=m.guild.id+":"+m.author.id,now=Date.now(),windowMs=(Number(cfg.spamWindowSeconds)||8)*1000;
 const history=(windows.get(key)||[]).filter(t=>now-t<windowMs);history.push(now);windows.set(key,history);
 const mentions=m.mentions.users.size+m.mentions.roles.size;
 if(cfg.antiMassMention!==false&&mentions>(Number(cfg.maxMentions)||5)){await m.delete().catch(()=>{});await logEvent(m.guild,"MASS MENTION BLOCKED",m.author.tag+" exceeded the mention limit.",[{name:"CHANNEL",value:m.channel.toString()},{name:"MENTIONS",value:String(mentions)}]);return;}
 if(cfg.antiLinks===true){const urls=m.content.match(/https?:\/\/[^\s<>]+/gi)||[],allowed=(cfg.allowedDomains||["overland.finance"]).map(x=>x.toLowerCase());const bad=urls.some(raw=>{try{const host=new URL(raw).hostname.toLowerCase().replace(/^www\./,"");return !allowed.some(d=>host===d||host.endsWith("."+d));}catch{return true;}});if(bad){await m.delete().catch(()=>{});await logEvent(m.guild,"LINK FILTER",m.author.tag+" posted a link outside the allowlist.",[{name:"CHANNEL",value:m.channel.toString()}]);return;}}
 if(cfg.antiSpam!==false&&history.length>=(Number(cfg.spamMessageLimit)||6)){await m.delete().catch(()=>{});windows.set(key,[]);member.spamFlags=(member.spamFlags||0)+1;await logEvent(m.guild,"SPAM RATE LIMIT","Rapid messages were removed. No automatic timeout was applied.",[{name:"MEMBER",value:m.author.tag},{name:"FLAGS",value:String(member.spamFlags)}]);}
 if(g.stats.messages%20===0)await saveStore();
}
export async function handleVoiceState(a,b){
 const guild=b.guild||a.guild,user=b.id||a.id,member=b.member||a.member;if(!guild||!member||member.user.bot)return;
 const g=getGuild(guild.id),key=guild.id+":"+user,before=a.channelId,after=b.channelId;
 if(!before&&after){voices.set(key,Date.now());const p=getMember(guild.id,member.user);p.voiceSessions=(p.voiceSessions||0)+1;await logEvent(guild,"VOICE JOIN",member.user.tag+" joined "+b.channel.toString()+".");}
 if(before&&!after){const start=voices.get(key);if(start){const p=getMember(guild.id,member.user);p.voiceSeconds=(p.voiceSeconds||0)+Math.floor((Date.now()-start)/1000);voices.delete(key);}await logEvent(guild,"VOICE LEAVE",member.user.tag+" left "+a.channel.toString()+".");}
 if(before&&after&&before!==after)await logEvent(guild,"VOICE MOVE",member.user.tag+" moved to "+b.channel.toString()+".");
 if(after&&g.settings.voiceHubChannelId===after){const ch=await guild.channels.create({name:(member.displayName||member.user.username).slice(0,80)+"'s room",type:2,parent:g.settings.tempVoiceCategoryId||undefined,permissionOverwrites:[{id:guild.roles.everyone.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect]},{id:user,allow:[PermissionFlagsBits.ManageChannels,PermissionFlagsBits.MoveMembers]}]});g.tempVoiceChannels.push(ch.id);await member.voice.setChannel(ch).catch(()=>ch.delete().catch(()=>{}));await saveStore();}
 if(before&&g.tempVoiceChannels.includes(before)){const ch=await guild.channels.fetch(before).catch(()=>null);if(ch&&ch.members.size===0){await ch.delete().catch(()=>{});g.tempVoiceChannels=g.tempVoiceChannels.filter(x=>x!==before);await saveStore();}}
}
export async function runMaintenance(client){
 const now=Date.now();for(const guild of client.guilds.cache.values()){const g=getGuild(guild.id);let changed=false;
 for(const x of [...g.tempRoles])if(new Date(x.expiresAt).getTime()<=now){const m=await guild.members.fetch(x.userId).catch(()=>null);if(m)await m.roles.remove(x.roleId,"Temporary role expired").catch(()=>{});g.tempRoles=g.tempRoles.filter(y=>y.id!==x.id);changed=true;}
 for(const t of g.tickets)if(t.status==="OPEN"&&t.lastActivityAt&&now-new Date(t.lastActivityAt).getTime()>7*86400000){const ch=await guild.channels.fetch(t.channelId).catch(()=>null);if(ch){await ch.permissionOverwrites.edit(t.ownerId,{ViewChannel:false,SendMessages:false}).catch(()=>{});await ch.setTopic("overland-ticket-closed:"+t.ownerId).catch(()=>{});await ch.setName(("closed-"+ch.name).slice(0,95)).catch(()=>{});if(g.settings.ticketArchiveCategoryId)await ch.setParent(g.settings.ticketArchiveCategoryId).catch(()=>{});await ch.send({embeds:[embed("TICKET ARCHIVED","Archived after seven days without activity. Open a new ticket if you still need help.")]}).catch(()=>{});}t.status="CLOSED";t.closedAt=new Date().toISOString();t.closedBy="SYSTEM_INACTIVITY";changed=true;}
 for(const r of [...g.reminders])if(new Date(r.at).getTime()<=now){const ch=await guild.channels.fetch(r.channelId).catch(()=>null);if(ch?.isTextBased())await ch.send({content:"<@"+r.userId+">",embeds:[embed("REMINDER",r.text)]}).catch(()=>{});g.reminders=g.reminders.filter(x=>x.id!==r.id);changed=true;}
 if(changed)await saveStore();
 }
}
