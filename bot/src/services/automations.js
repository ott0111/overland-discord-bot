import { Events, PermissionFlagsBits, ChannelType, ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";
import { getGuild, getMember, saveStore } from "../store.js";
import { embed, BRAND } from "../commands/helpers.js";

async function log(guild,title,description,color=BRAND.primary){
  const cfg=getGuild(guild.id).settings,id=cfg.eventLogChannelId||cfg.modLogChannelId;
  if(!id)return;
  const channel=await guild.channels.fetch(id).catch(()=>null);
  if(channel?.isTextBased())await channel.send({embeds:[embed(title,description,color)]}).catch(()=>{});
}
export function registerAutomations(client){
  const windows=new Map();
  client.on(Events.GuildMemberAdd,async member=>{
    try{
      const g=getGuild(member.guild.id),v=g.settings.verification,now=Date.now();
      g.stats.joins++;g.recentJoins=g.recentJoins.filter(t=>now-t<v.antiRaidWindowMinutes*60000);g.recentJoins.push(now);
      const tracked=getMember(member.guild.id,member.user);
      if(g.recentJoins.length>=v.antiRaidThreshold)tracked.suspicious=true;
      if(g.settings.welcomeEnabled&&g.settings.welcomeChannelId){
        const ch=await member.guild.channels.fetch(g.settings.welcomeChannelId).catch(()=>null);
        if(ch?.isTextBased())await ch.send({embeds:[embed("WELCOME TO OVERLAND",g.settings.welcomeMessage.replaceAll("{user}",member.toString()).replaceAll("{server}",member.guild.name)).setThumbnail(member.user.displayAvatarURL({size:256})).addFields({name:"MEMBER",value:member.user.username,inline:true},{name:"COMMUNITY SIZE",value:String(member.guild.memberCount),inline:true})]});
      }
      await log(member.guild,"MEMBER JOINED",member.user.tag+" ("+member.id+") joined. Account created <t:"+Math.floor(member.user.createdTimestamp/1000)+":R>.");
      await saveStore();
    }catch(e){console.error("[MemberJoin]",e);}
  });
  client.on(Events.GuildMemberRemove,async member=>{
    try{
      const g=getGuild(member.guild.id);g.stats.leaves++;
      if(g.settings.leaveChannelId){const ch=await member.guild.channels.fetch(g.settings.leaveChannelId).catch(()=>null);if(ch?.isTextBased())await ch.send({embeds:[embed("MEMBER LEFT",g.settings.leaveMessage.replaceAll("{user}",member.user.tag).replaceAll("{server}",member.guild.name))]});}
      await log(member.guild,"MEMBER LEFT",member.user.tag+" ("+member.id+") left the server.");await saveStore();
    }catch(e){console.error("[MemberLeave]",e);}
  });
  client.on(Events.GuildMemberUpdate,async(oldM,newM)=>{
    try{
      if(oldM.nickname!==newM.nickname)await log(newM.guild,"NICKNAME UPDATED",newM.user.tag+": "+(oldM.nickname||"none")+" → "+(newM.nickname||"none"));
      const added=newM.roles.cache.filter(r=>!oldM.roles.cache.has(r.id)),removed=oldM.roles.cache.filter(r=>!newM.roles.cache.has(r.id));
      if(added.size||removed.size)await log(newM.guild,"ROLE UPDATE",newM.user.tag+"\nAdded: "+(added.map(r=>r.name).join(", ")||"none")+"\nRemoved: "+(removed.map(r=>r.name).join(", ")||"none"));
      if(!oldM.premiumSince&&newM.premiumSince)await log(newM.guild,"SERVER BOOST",newM.user.tag+" boosted Overland. Thank you for supporting the community.",BRAND.success);
    }catch(e){console.error("[MemberUpdate]",e);}
  });
  client.on(Events.MessageCreate,async m=>{
    if(!m.guild||m.author.bot)return;
    const g=getGuild(m.guild.id),cfg=g.settings.security,now=Date.now(),key=m.guild.id+":"+m.author.id;
    g.stats.messages++;getMember(m.guild.id,m.author);
    const recent=(windows.get(key)||[]).filter(t=>now-t<cfg.spamWindowMs);recent.push(now);windows.set(key,recent);
    const link=/https?:\/\/|discord\.gg\/|www\./i.test(m.content),allowed=cfg.allowedDomains.some(d=>m.content.toLowerCase().includes(d.toLowerCase()));
    const mentions=m.mentions.users.size+m.mentions.roles.size;
    let reason=null;
    if(cfg.antiSpamEnabled&&recent.length>=cfg.spamThreshold)reason="Repeated message spam";
    else if(cfg.antiLinkEnabled&&link&&!allowed)reason="Unapproved link";
    else if(cfg.massMentionEnabled&&mentions>cfg.maxMentions)reason="Excessive mentions";
    if(reason){
      await m.delete().catch(()=>{});
      const member=await m.guild.members.fetch(m.author.id).catch(()=>null);
      if(member?.moderatable)await member.timeout(cfg.timeoutMinutes*60000,reason).catch(()=>{});
      await log(m.guild,"AUTOMOD ACTION","**Member:** "+m.author.tag+"\n**Reason:** "+reason+"\n**Action:** Message removal and timeout attempted.",BRAND.warning);
    }
    if(windows.size>5000)for(const [k,v] of windows)if(!v.length||now-v[v.length-1]>60000)windows.delete(k);
    if(g.stats.messages%25===0)await saveStore();
  });
  client.on(Events.MessageDelete,async m=>{
    if(!m.guild||m.author?.bot)return;
    const g=getGuild(m.guild.id);g.stats.deletedMessages++;
    await log(m.guild,"MESSAGE DELETED","**Channel:** "+m.channel+"\n**Author:** "+(m.author?.tag||"Unknown")+"\n**Content:** "+(m.content?.slice(0,700)||"Unavailable"));
  });
  client.on(Events.MessageUpdate,async(oldM,newM)=>{
    if(!newM.guild||newM.author?.bot||oldM.content===newM.content)return;
    await log(newM.guild,"MESSAGE EDITED","**Channel:** "+newM.channel+"\n**Author:** "+(newM.author?.tag||"Unknown")+"\n**Before:** "+(oldM.content?.slice(0,400)||"Unavailable")+"\n**After:** "+(newM.content?.slice(0,400)||"Unavailable"));
  });
  client.on(Events.ChannelCreate,ch=>{if(ch.guild)log(ch.guild,"CHANNEL CREATED",ch.toString()+" ("+ch.id+")");});
  client.on(Events.ChannelDelete,ch=>{if(ch.guild)log(ch.guild,"CHANNEL DELETED","#"+ch.name+" ("+ch.id+")",BRAND.warning);});
  client.on(Events.GuildRoleCreate,r=>log(r.guild,"ROLE CREATED",r.name+" ("+r.id+")"));
  client.on(Events.GuildRoleDelete,r=>log(r.guild,"ROLE DELETED",r.name+" ("+r.id+")",BRAND.warning));
  client.on(Events.GuildBanAdd,b=>log(b.guild,"MEMBER BANNED",b.user.tag+" ("+b.user.id+")",BRAND.warning));
  client.on(Events.VoiceStateUpdate,async(oldS,newS)=>{
    try{
      const guild=newS.guild,g=getGuild(guild.id),cfg=g.settings.voice,member=newS.member||oldS.member;
      if(oldS.channelId&&!newS.channelId){
        const started=cfg.voiceSessions[member.id];
        if(started){const mins=Math.max(0,Math.floor((Date.now()-started)/60000));cfg.voiceStats[member.id]=(cfg.voiceStats[member.id]||0)+mins;g.stats.voiceMinutes+=mins;delete cfg.voiceSessions[member.id];}
        await log(guild,"VOICE LEFT",member.user.tag+" left "+oldS.channel?.name+".");
      }else if(!oldS.channelId&&newS.channelId){
        cfg.voiceSessions[member.id]=Date.now();await log(guild,"VOICE JOINED",member.user.tag+" joined "+newS.channel.name+".");
        if(cfg.enabled&&cfg.lobbyChannelId===newS.channelId){
          const room=await guild.channels.create({name:(member.user.username+"'s room").slice(0,95),type:ChannelType.GuildVoice,parent:cfg.categoryId||undefined,permissionOverwrites:[{id:guild.roles.everyone.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.Connect]},{id:member.id,allow:[PermissionFlagsBits.ManageChannels,PermissionFlagsBits.MoveMembers]}]});
          cfg.autoVoiceRooms[room.id]=member.id;await member.voice.setChannel(room).catch(()=>{});
        }
      }else if(oldS.channelId&&newS.channelId&&oldS.channelId!==newS.channelId){
        await log(guild,"VOICE MOVED",member.user.tag+" moved from "+oldS.channel?.name+" to "+newS.channel?.name+".");
      }
      const roomId=oldS.channelId||newS.channelId;
      if(roomId&&cfg.autoVoiceRooms[roomId]){
        const room=await guild.channels.fetch(roomId).catch(()=>null);
        if(room&&room.members.size===0){delete cfg.autoVoiceRooms[roomId];await room.delete("Temporary Overland voice room empty").catch(()=>{});}
      }
      await saveStore();
    }catch(e){console.error("[VoiceState]",e);}
  });
  client.on(Events.InteractionCreate,async i=>{
    if(!i.isButton())return;
    try{
      if(i.customId.startsWith("overland:role:toggle:")){
        const roleId=i.customId.split(":")[3],role=i.guild.roles.cache.get(roleId);
        if(!role||role.managed||role.permissions.has(PermissionFlagsBits.Administrator)||role.position>=i.guild.members.me.roles.highest.position)throw new Error("This role is not available for self-assignment.");
        const member=await i.guild.members.fetch(i.user.id);
        if(member.roles.cache.has(roleId)){await member.roles.remove(role);return i.reply({content:"Removed "+role.name+".",ephemeral:true});}
        await member.roles.add(role);return i.reply({content:"Added "+role.name+".",ephemeral:true});
      }
      if(i.customId.startsWith("overland:ticket:feedback:")){
        const rating=Number(i.customId.split(":").pop()),g=getGuild(i.guildId),record=g.tickets.find(t=>t.channelId===i.channelId);
        if(!record||record.ownerId!==i.user.id)throw new Error("Only the ticket owner can leave feedback.");
        if(record.feedback)throw new Error("Feedback has already been submitted.");
        record.feedback={rating,at:new Date().toISOString()};await saveStore();
        return i.reply({embeds:[embed("FEEDBACK RECEIVED","Thank you. Your "+rating+"/5 rating has been recorded.")],ephemeral:true});
      }
    }catch(e){if(!i.replied&&!i.deferred)await i.reply({content:e.message,ephemeral:true}).catch(()=>{});}
  });
}
