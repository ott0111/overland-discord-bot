
import { PrismaClient } from "@prisma/client";
import { DEFAULT_POINT_VALUES, DEFAULT_GROUP_PERMISSIONS, PERMISSIONS } from "../packages/shared/src/index";
const prisma = new PrismaClient();
async function main() {
  for (const name of ["Founder","Admin","Warden","Pioneer","Luminary","Creator","Intellect","Socialite","Comrade","Citizen"]) {
    await prisma.role.upsert({ where: { name }, update: {}, create: { name, isInternal: ["Founder","Admin","Warden"].includes(name), description: `${name} role for Overland Finance` } });
  }
  const citizen = await prisma.role.findUnique({ where: { name: "Citizen" } });
  if (citizen) await prisma.role.update({ where: { name: "Comrade" }, data: { requiresRoleId: citizen.id } });
  const groupNames = ["Owner","Executive","Administration","Moderation","Development","Support","Rewards_Management"] as const;
  for (const g of groupNames) {
    const group = await prisma.permissionGroup.upsert({ where: { name: g as never }, update: {}, create: { name: g as never } });
    const defaultKeys = g === "Owner" ? PERMISSIONS : (DEFAULT_GROUP_PERMISSIONS[g] ?? []);
    for (const key of defaultKeys) {
      await prisma.permission.upsert({
        where: { key_groupId: { key, groupId: group.id } },
        update: {},
        create: { key, groupId: group.id },
      });
    }
  }
  // Bootstrap the first Founder/Owner so the dashboard is not locked behind
  // a staff record that nobody can create yet. No Discord role grants these permissions.
  const founderDiscordId = process.env.OVERLAND_OWNER_DISCORD_ID?.trim();
  if (founderDiscordId && /^\d{17,20}$/.test(founderDiscordId)) {
    const founderUsername = process.env.OVERLAND_OWNER_USERNAME?.trim() || "Founder";
    const ownerGroup = await prisma.permissionGroup.findUnique({ where: { name: "Owner" } });
    if (!ownerGroup) throw new Error("Owner permission group is missing");
    const founderUser = await prisma.user.upsert({
      where: { discordId: founderDiscordId },
      update: { username: founderUsername },
      create: { discordId: founderDiscordId, username: founderUsername },
    });
    const founderMember = await prisma.discordMember.upsert({
      where: { userId: founderUser.id },
      update: {},
      create: { userId: founderUser.id, guildId: process.env.DISCORD_GUILD_ID ?? "" },
    });
    await prisma.internalTeamMember.upsert({
      where: { discordId: founderDiscordId },
      update: {
        username: founderUsername,
        publicRole: "Founder",
        jobTitle: "Founder",
        department: "Executive",
        groupId: ownerGroup.id,
        status: "ACTIVE",
      },
      create: {
        memberId: founderMember.id,
        discordId: founderDiscordId,
        username: founderUsername,
        publicRole: "Founder",
        jobTitle: "Founder",
        department: "Executive",
        responsibilities: "Full control of Overland Finance community operations.",
        groupId: ownerGroup.id,
        status: "ACTIVE",
      },
    });
    console.log("Founder Owner access bootstrapped for configured Discord ID.");
  }

  const achievements: Array<[string,string,string,number,number]> = [
    ["first-verification","First Verification","Complete Discord verification","VERIFICATION",10,0],
    ["first-contribution","First Contribution","Get a contribution approved","CONTRIBUTION",20,5],
    ["first-referral","First Referral","Bring in a verified referral","REFERRAL",15,5],
    ["first-social","First Social Submission","Get a social submission approved","SOCIAL",15,5],
    ["streak-7","Seven Day Streak","Check in 7 days in a row","STREAK",25,10],
    ["streak-30","Thirty Day Streak","Check in 30 days in a row","STREAK",100,25],
  ];
  for (const [key,name,desc,kind,op,oc] of achievements) await prisma.achievement.upsert({ where: { key }, update: {}, create: { key, name, description: desc, kind: kind as never, overpointsReward: op, overcreditsReward: oc } });
  const configs: Record<string, unknown> = {
    pointValues: DEFAULT_POINT_VALUES, dailyLimits: { overpoints: 100, overcredits: 100 },
    verification: { minAccountAgeDays: 7, requireCaptcha: true, requireAvatar: false, antiRaidWindowMinutes: 10, antiRaidThreshold: 10 },
    moderation: { profanityFilter: true, profanityWords: [], inviteFilter: true, maxMentions: 5, spamWindowSeconds: 10, spamMaxMessages: 5, suspiciousLinkAction: "delete" },
    xIntegration: { enabled: false, username: "OverlandFinance", ignoreReplies: true, ignoreReposts: true, pollMinutes: 15 },
    infoContent: { about: "Overland Finance is the commerce layer for digital dollars.", links: "https://overland-finance.vercel.app/", team: "Founder led team.", roadmap: "See our website for the latest roadmap.", updates: "No updates yet.", faq: "Ask in support.", opportunities: "Partnerships open.", socials: "X: @OverlandFinance" },
    welcome: { enabled: true, channelId: null, title: "Welcome to {server}, {user}!", message: "We are glad you are here. Read the rules and complete verification to get started.", sendDm: false },
    socialLinks: [], tickets: { staffRoleId: null, categoryChannelId: null },
  };
  for (const [key,value] of Object.entries(configs)) await prisma.botConfiguration.upsert({ where: { key }, update: { value: value as never }, create: { key, value: value as never } });
  console.log("Seed complete.");
}
main().catch((e)=>{ console.error(e); process.exit(1); }).finally(()=>prisma.$disconnect());
