import "dotenv/config";
import {Client,GatewayIntentBits,Events,REST,Routes,MessageFlags,ChannelType,PermissionFlagsBits,ActionRowBuilder,ButtonBuilder,ButtonStyle} from "discord.js";
import {loadCommands} from "./commands/loader.js";
import {loadStore,getGuild,getMember,saveStore} from "./store.js";
import {embed} from "./commands/helpers.js";
import {checkProgression,syncDiscordRole} from "./services/roles.js";
import {recordJoin,processReferralMilestones} from "./services/referrals.js";
import {award} from "./services/economy.js";
import {startCoreApi} from "./api.js";
import {closePool} from "./db/mysql.js";
import { registerAutomations } from "./services/automations.js";
import { createTicketRecord, getTicketByChannel, updateTicket, appendTicketMessage } from "./db/repositories/tickets-rewards.js";
import { getMemberVerification, acceptMemberRules, saveVerificationChallenge } from "./db/repositories/roles.js";
import { bootstrapOwner } from "./db/repositories/team.js";

const token=process.env.DISCORD_TOKEN;
if(!token){console.error("[Overland] DISCORD_TOKEN is missing. Add it to bot/.env or your host's environment variables.");process.exit(1);}
const guildId=process.env.DISCORD_GUILD_ID||null;
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildMessages,GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.MessageContent]});
const commands=await loadCommands();
const inviteCache=new Map();

function ownerBootstrap(){
 const id=process.env.OVERLAND_OWNER_DISCORD_ID;
 if(!id)return;
 const g=getGuild(process.env.DISCORD_GUILD_ID||client.guilds.cache.first()?.id);
 if(!g)return;
 const perms=["roles.manage","roles.verify_x","economy.manage","campaigns.manage","campaigns.review","rewards.manage","rewards.review","config.manage","community.manage","moderation.manage","team.manage","x.manage"];
 g.team=g.team.filter(x=>x.discordId!==id);
 g.team.push({discordId:id,username:process.env.OVERLAND_OWNER_USERNAME||"Owner",group:"Owner",permissions:perms,status:"ACTIVE",addedBy:"ENVIRONMENT",addedAt:new Date().toISOString()});
 return saveStore();
}
async function syncCommands(appId){
 const body=[...commands.values()].map(c=>c.data.toJSON());
 if(body.length>100)throw new Error("Discord application command limit exceeded: "+body.length+"/100.");
 const rest=new REST({version:"10"}).setToken(token);
 let route;
 if(guildId){
  try{await client.guilds.fetch(guildId);}catch(e){throw new Error("DISCORD_GUILD_ID "+guildId+" is invalid or the bot is not in that server. "+e.message);}
  route=Routes.applicationGuildCommands(appId,guildId);
 }else route=Routes.applicationCommands(appId);
 console.log("[Commands] Registering "+body.length+" commands to "+(guildId?"guild "+guildId:"global application "+appId)+"...");
 for(let attempt=1;attempt<=3;attempt++){
  try{
   const result=await rest.put(route,{body});
   console.log("[Commands] Successfully registered "+result.length+" slash commands.");
   if(!guildId)console.warn("[Commands] Global commands can take up to an hour to appear. Set DISCORD_GUILD_ID for instant guild registration.");
   return;
  }catch(error){
   console.error("[Commands] Registration attempt "+attempt+" failed:",{status:error.status,code:error.code,message:error.message});
   if(attempt===3)throw new Error("Slash command registration failed. Confirm DISCORD_TOKEN belongs to DISCORD_CLIENT_ID, the bot invite includes applications.commands, and it has access to the configured guild.");
   await new Promise(r=>setTimeout(r,attempt*2000));
  }
 }
}
async function cacheInvites(guild){
 try{const invites=await guild.invites.fetch();inviteCache.set(guild.id,new Map(invites.map(x=>[x.code,x.uses||0])));}catch(e){console.warn("[Invites] Cannot read invite uses in "+guild.name+". Grant Manage Guild to track referrals.",e.message);}
}
async function announceXPosts(){
 const token=process.env.X_BEARER_TOKEN;if(!token)return;
 for(const guild of client.guilds.cache.values()){
  const cfg=getGuild(guild.id).settings.x;if(!cfg.username||!cfg.channelId)continue;
  try{
   const userRes=await fetch("https://api.x.com/2/users/by/username/"+encodeURIComponent(cfg.username),{headers:{Authorization:"Bearer "+token}});
   if(!userRes.ok)throw new Error("X user lookup HTTP "+userRes.status);
   const user=(await userRes.json()).data;if(!user?.id)continue;
   const params=new URLSearchParams({"tweet.fields":"referenced_tweets,attachments","max_results":"10"});
   if(cfg.lastPostId)params.set("since_id",cfg.lastPostId);
   const res=await fetch("https://api.x.com/2/users/"+user.id+"/tweets?"+params,{headers:{Authorization:"Bearer "+token}});
   if(!res.ok)throw new Error("X timeline HTTP "+res.status);
   const data=await res.json(),posts=(data.data||[]).reverse();
   for(const p of posts){
    const refs=p.referenced_tweets||[];
    if(cfg.ignoreReplies&&refs.some(x=>x.type==="replied_to"))continue;
    if(cfg.ignoreReposts&&refs.some(x=>x.type==="retweeted"))continue;
    if(getGuild(guild.id).xPosts.some(x=>x.id===p.id))continue;
    const ch=await guild.channels.fetch(cfg.channelId).catch(()=>null);
    if(ch?.isTextBased())await ch.send({embeds:[embed("@"+cfg.username+" on X",p.text+"\n\nhttps://x.com/"+cfg.username+"/status/"+p.id)]});
    getGuild(guild.id).xPosts.unshift({id:p.id,at:new Date().toISOString()});
    cfg.lastPostId=p.id;
   }
   await saveStore();
  }catch(e){console.error("[X] Poll failed for "+guild.name+":",e.message);}
 }
}
async function handleVerifyButton(i){
 const m=getMember(i.guildId,i.user),g=getGuild(i.guildId),v=g.settings.verification;
 const mysqlMode=process.env.OVERLAND_STORAGE==="mysql";
 const state=mysqlMode?await getMemberVerification(i.guildId,i.user):null;
 const rulesAccepted=state?Boolean(state.profile?.rulesAcceptedAt):Boolean(m.rulesAcceptedAt);
 const suspicious=state?state.isSuspicious:Boolean(m.suspicious);
 const verifiedAt=state?.verifiedAt||m.verifiedAt;
 if(!rulesAccepted)throw new Error("Please review and accept the server rules with /rules before verifying.");if(g.blacklist.some(x=>x.userId===i.user.id))throw new Error("Your account is on the Overland participation blacklist.");if(!v.enabled)throw new Error("Verification is currently disabled.");if(suspicious)throw new Error("Your account was flagged by anti-raid protection. Contact staff for manual verification.");const ageDays=(Date.now()-i.user.createdTimestamp)/86400000;if(ageDays<v.minAccountAgeDays)throw new Error("Your Discord account must be at least "+v.minAccountAgeDays+" days old.");if(v.requireAvatar&&!i.user.avatar)throw new Error("Please set a Discord avatar before verifying.");if(verifiedAt)return i.reply({content:"You are already verified.",flags:MessageFlags.Ephemeral});
 const a=Math.floor(Math.random()*8)+2,b=Math.floor(Math.random()*8)+2;
 const challenge={answer:a+b,expiresAt:Date.now()+600000,attempts:0};
 if(mysqlMode)await saveVerificationChallenge(i.guildId,i.user,challenge);else{m.verification=challenge;await saveStore();}
 return i.reply({embeds:[embed("Verification challenge","Solve this simple check: **"+a+" + "+b+" = ?**\nSubmit the answer using /verify-answer.\nThis challenge expires in 10 minutes.")],flags:MessageFlags.Ephemeral});
}
async function createTicket(i,category="support"){
 const g=getGuild(i.guildId),guild=i.guild;
 const existing=guild.channels.cache.find(c=>c.type===ChannelType.GuildText&&c.topic==="overland-ticket:"+i.user.id);
 if(existing)return i.reply({embeds:[embed("SUPPORT  /  OPEN TICKET","You already have an active support room: "+existing)],flags:MessageFlags.Ephemeral});
 const support=g.settings.ticketSupportRoleId;
 const overwrites=[
  {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel]},
  {id:i.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles]},
  {id:client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ReadMessageHistory]}
 ];
 if(support)overwrites.push({id:support,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.AttachFiles]});
 const slug=i.user.username.toLowerCase().replace(/[^a-z0-9-]/g,"-").slice(0,18)||"member";
 const ch=await guild.channels.create({name:"ticket-"+category+"-"+slug,type:ChannelType.GuildText,parent:g.settings.ticketCategoryId||undefined,topic:"overland-ticket:"+i.user.id,permissionOverwrites:overwrites});
 const record={id:"OV-"+Date.now().toString(36).toUpperCase(),channelId:ch.id,ownerId:i.user.id,ownerTag:i.user.tag,category,status:"OPEN",claimedBy:null,createdAt:new Date().toISOString(),closedAt:null,feedback:null};
 if(process.env.OVERLAND_STORAGE==="mysql")await createTicketRecord(i.guildId,{id:record.id,category,channelId:ch.id,ownerId:i.user.id});else{g.tickets.unshift(record);await saveStore();}
 const ticketEmbed=embed("OVERLAND SUPPORT  /  "+category.toUpperCase(),"Your private support room is ready. Please explain what you need help with.\n\n**Reference:** "+record.id+"\n**Opened by:** "+i.user)
  .addFields({name:"Helpful details",value:"Include relevant links, transaction references, screenshots, and the steps you have already taken.",inline:false},{name:"Security reminder",value:"Never share passwords, seed phrases, private keys, or authentication codes.",inline:false});
 await ch.send({content:i.user.toString()+(support?" <@&"+support+">":""),embeds:[ticketEmbed],components:[new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("overland:ticket:close").setLabel("Close ticket").setStyle(ButtonStyle.Secondary))],allowedMentions:{users:[i.user.id],roles:support?[support]:[]}});
 await i.reply({embeds:[embed("TICKET CREATED","Your private support channel is ready: "+ch+"\nReference: **"+record.id+"**")],flags:MessageFlags.Ephemeral});
}
async function handleInteraction(i){
 try{
  if(i.isButton()&&i.customId==="overland:rules:accept"){if(process.env.OVERLAND_STORAGE==="mysql")await acceptMemberRules(i.guildId,i.user);else{const m=getMember(i.guildId,i.user);m.rulesAcceptedAt=new Date().toISOString();await saveStore();}return i.reply({content:"Rules accepted. You can now complete /verify.",flags:MessageFlags.Ephemeral});}
  if(i.isButton()&&i.customId==="overland:verify:start")return await handleVerifyButton(i);
  if(i.isButton()&&i.customId==="overland:ticket:create")return await createTicket(i);
  if(i.isStringSelectMenu()&&i.customId==="overland:ticket:category")return await createTicket(i,i.values[0]);
  if(i.isButton()&&i.customId==="overland:ticket:close"){
   const topic=i.channel.topic||"",owner=topic.startsWith("overland-ticket:")?topic.slice(16):null;
   const staff=i.memberPermissions?.has(PermissionFlagsBits.ManageChannels);
   if(!owner||(!topic.startsWith("overland-ticket:"))|| (owner!==i.user.id&&!staff))return i.reply({content:"Only the ticket creator or staff can close this.",flags:MessageFlags.Ephemeral});
   const g=getGuild(i.guildId),record=process.env.OVERLAND_STORAGE==="mysql"?await getTicketByChannel(i.guildId,i.channelId):g.tickets.find(t=>t.channelId===i.channelId);
   if(record){if(process.env.OVERLAND_STORAGE==="mysql")await updateTicket(i.guildId,record.id,"close",{actorId:i.user.id});else{record.status="CLOSED";record.closedAt=new Date().toISOString();record.closedBy=i.user.id;}}
   await i.channel.permissionOverwrites.edit(owner,{ViewChannel:true,SendMessages:false,ReadMessageHistory:true}).catch(()=>{});
   await i.channel.setTopic("overland-ticket-closed:"+owner).catch(()=>{});
   await i.channel.setName(("closed-"+i.channel.name).slice(0,95)).catch(()=>{});
   if(g.settings.ticketArchiveCategoryId)await i.channel.setParent(g.settings.ticketArchiveCategoryId).catch(()=>{});
   if(process.env.OVERLAND_STORAGE!=="mysql")await saveStore();
   await i.reply({embeds:[embed("TICKET ARCHIVED","This ticket has been closed and retained for staff review.")],flags:MessageFlags.Ephemeral});
   const feedbackRow=new ActionRowBuilder().addComponents(...[1,2,3,4,5].map(n=>new ButtonBuilder().setCustomId("overland:ticket:feedback:"+n).setLabel(n+" / 5").setStyle(n>=4?ButtonStyle.Success:ButtonStyle.Secondary))); 
   await i.channel.send({embeds:[embed("HOW DID WE DO?","If you opened this ticket, rate your support experience below.")],components:[feedbackRow]}).catch(()=>{});
   await i.channel.send({embeds:[embed("TICKET CLOSED","This ticket was closed by "+i.user+". Staff can still review its history.")] }).catch(()=>{});
   return;
  }
  if(!i.isChatInputCommand())return;
  const c=commands.get(i.commandName);if(!c)return;
  await c.execute(i);
 }catch(error){
  console.error("[Interaction] "+(i.commandName||i.customId)+" failed:",error);
  const content=error.message||"The request failed. Check the bot logs.";
  try{if(i.deferred||i.replied)await i.followUp({content,flags:MessageFlags.Ephemeral});else await i.reply({content,flags:MessageFlags.Ephemeral});}catch{}
 }
}
client.on(Events.InteractionCreate,handleInteraction);
registerAutomations(client);
client.on(Events.GuildMemberAdd,async member=>{
 try{
  const g=getGuild(member.guild.id);g.stats.joins++;const v=g.settings.verification,now=Date.now();g.recentJoins=g.recentJoins.filter(t=>now-t<v.antiRaidWindowMinutes*60000);g.recentJoins.push(now);const tracked=getMember(member.guild.id,member.user);if(g.recentJoins.length>=v.antiRaidThreshold)tracked.suspicious=true;
  const current=await member.guild.invites.fetch().catch(()=>null),previous=inviteCache.get(member.guild.id)||new Map();let used=null;
  if(current){for(const inv of current.values()){if((inv.uses||0)>(previous.get(inv.code)||0)){used=inv;break;}}inviteCache.set(member.guild.id,new Map(current.map(x=>[x.code,x.uses||0])));}
  if(used)await recordJoin(member.guild.id,member,used.code);
  const cfg=g.settings;
  if(cfg.autoRoleId){const role=await member.guild.roles.fetch(cfg.autoRoleId).catch(()=>null);if(role)await member.roles.add(role).catch(e=>console.error("[AutoRole]",e.message));}
  if(cfg.welcomeEnabled&&cfg.welcomeChannelId){const ch=await member.guild.channels.fetch(cfg.welcomeChannelId).catch(()=>null);if(ch?.isTextBased())await ch.send({embeds:[embed("Welcome to Overland",cfg.welcomeMessage.replaceAll("{user}",member.toString()).replaceAll("{server}",member.guild.name))]});}
  if(cfg.welcomeDm)await member.send({embeds:[embed("Welcome to Overland","Welcome to "+member.guild.name+". Please review the rules and complete verification to get started.")] }).catch(()=>{});
  await saveStore();
 }catch(e){console.error("[GuildMemberAdd]",e);}
});
client.on(Events.GuildMemberRemove,async m=>{getGuild(m.guild.id).stats.leaves++;await saveStore();});
client.on(Events.GuildMemberUpdate,async(_oldMember,newMember)=>{
 try{
  const g=getGuild(newMember.guild.id),member=getMember(newMember.guild.id,newMember.user);
  for(const [name,roleId] of Object.entries(g.settings.roleIds)){
   const expected=member.roles.includes(name),actual=newMember.roles.cache.has(roleId);
   if(expected!==actual){
    await syncDiscordRole(g,newMember,name,expected).catch(e=>console.error("[RoleSync] "+name+":",e.message));
    g.roleHistory.unshift({id:crypto.randomUUID(),memberId:member.id,role:name,action:expected?"RECONCILED_ADD":"RECONCILED_REMOVE",actorId:"SYSTEM",reason:"Discord role state reconciled with Overland role ledger",at:new Date().toISOString()});
   }
  }
  await saveStore();
 }catch(e){console.error("[RoleSync]",e);}
});
client.on(Events.MessageCreate,async m=>{if(!m.guild||m.author.bot)return;const g=getGuild(m.guild.id);g.stats.messages++;getMember(m.guild.id,m.author);if(process.env.OVERLAND_STORAGE==="mysql"&&m.channel?.isTextBased())await appendTicketMessage(m.guild.id,m.channel.id,m.author.id,m.content).catch(e=>console.error("[TicketMessage]",e.message));if(g.stats.messages%25===0)await saveStore();});
client.once(Events.ClientReady,async ready=>{
 console.log("[Overland] Connected as "+ready.user.tag+" ("+ready.user.id+")");
 ready.user.setPresence({
  activities:[{name:"Overland Finance",type:0,state:"The Overland ecosystem | overland-finance.vercel.app/om"}],
  status:"online"
 });
 console.log("[Presence] Set activity to Overland Finance.");
 try{
  await ready.application.fetch();
  const appId=ready.application.id;
  if(process.env.DISCORD_CLIENT_ID&&process.env.DISCORD_CLIENT_ID!==ready.application.id)console.warn("[Commands] DISCORD_CLIENT_ID does not match the logged-in bot application. Ignoring it and using the application ID from the bot token.");
  await syncCommands(appId);
 }catch(e){console.error("[Commands] FATAL: "+e.message);console.error("[Commands] Exiting because slash commands could not be registered. Fix the settings and restart.");process.exit(1);}
 for(const g of ready.guilds.cache.values())await cacheInvites(g);
 const owner=process.env.OVERLAND_OWNER_DISCORD_ID;if(owner){for(const g of ready.guilds.cache.values()){if(process.env.OVERLAND_STORAGE==="mysql")await bootstrapOwner(g.id,owner,process.env.OVERLAND_OWNER_USERNAME||"Owner");else{const data=getGuild(g.id),perms=["roles.manage","roles.verify_x","economy.manage","campaigns.manage","campaigns.review","rewards.manage","rewards.review","config.manage","community.manage","moderation.manage","team.manage","x.manage"];data.team=data.team.filter(x=>x.discordId!==owner);data.team.push({discordId:owner,username:process.env.OVERLAND_OWNER_USERNAME||"Owner",group:"Owner",permissions:perms,status:"ACTIVE",addedBy:"ENVIRONMENT"});}}if(process.env.OVERLAND_STORAGE!=="mysql")await saveStore();}
 console.log("[Overland] Loaded "+commands.size+" modular commands.");
});
const xTimer=setInterval(()=>announceXPosts().catch(e=>console.error("[X]",e)),5*60*1000);
const saveTimer=setInterval(()=>saveStore().catch(e=>console.error("[Storage]",e)),15000);
const referralTimer=setInterval(async()=>{for(const guild of client.guilds.cache.values())await processReferralMilestones(guild.id,guild).catch(e=>console.error("[Referrals]",e));},60*60*1000);
async function shutdown(signal){console.log("[Overland] "+signal+" received. Saving data.");clearInterval(xTimer);clearInterval(saveTimer);clearInterval(referralTimer);await saveStore();client.destroy();await closePool();process.exit(0);}
process.on("SIGINT",()=>shutdown("SIGINT"));process.on("SIGTERM",()=>shutdown("SIGTERM"));
await loadStore();
await ownerBootstrap();
startCoreApi(client);
await client.login(token);
