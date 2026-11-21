
export const BRAND = {
  name: "Overland Core",
  org: "Overland Finance",
  colors: { emerald: 0x00c982, emeraldHex: "#00C982", lime: 0xc5e86c, limeHex: "#C5E86C", dark: 0x0b0f0e, darkHex: "#0B0F0E", muted: 0x9aa5a0 },
} as const;
export const PUBLIC_ROLES = ["Founder","Admin","Warden","Pioneer","Luminary","Creator","Intellect","Socialite","Comrade","Citizen"] as const;
export type PublicRoleName = (typeof PUBLIC_ROLES)[number];
export const INTERNAL_ROLES = ["Founder","Admin","Warden"] as const;
export const PERMISSION_GROUPS = ["Owner","Executive","Administration","Moderation","Development","Support","Rewards Management"] as const;
export const PERMISSIONS = [
  "team.view","team.manage","roles.assign","roles.manage","economy.adjust","economy.view",
  "campaigns.manage","campaigns.review","community.manage","referrals.view","rewards.manage","rewards.review",
  "tickets.view","tickets.manage","moderation.action","moderation.view","config.manage",
  "x.manage","analytics.view","audit.view","achievements.manage",
] as const;
export type PermissionKey = (typeof PERMISSIONS)[number];

export const DEFAULT_GROUP_PERMISSIONS: Record<string, readonly PermissionKey[]> = {
  Executive: [
    "team.view", "roles.assign", "roles.manage", "economy.view", "economy.adjust",
    "campaigns.manage", "campaigns.review", "community.manage", "referrals.view", "rewards.manage",
    "rewards.review", "tickets.view", "tickets.manage", "moderation.view",
    "analytics.view", "audit.view", "achievements.manage",
  ],
  Administration: [
    "team.view", "roles.assign", "roles.manage", "economy.view", "campaigns.manage",
    "campaigns.review", "community.manage", "referrals.view", "rewards.manage", "rewards.review",
    "tickets.view", "tickets.manage", "moderation.view", "moderation.action",
    "config.manage", "analytics.view", "audit.view", "achievements.manage", "x.manage",
  ],
  Moderation: [
    "moderation.view", "moderation.action", "tickets.view", "tickets.manage", "audit.view",
  ],
  Development: [
    "analytics.view", "audit.view",
  ],
  Support: [
    "tickets.view", "tickets.manage",
  ],
  Rewards_Management: [
    "economy.view", "rewards.manage", "rewards.review", "referrals.view",
  ],
};

export const DEFAULT_POINT_VALUES = {
  community: { dailyCheckin: 5, participation: 2, helpfulAnswer: 5, eventParticipation: 15, weeklyChallenge: 20, approvedContribution: 20 },
  social: { xPost: 15, infographic: 25, educationalThread: 30, article: 30, campaignContribution: 20, video: 30 },
  referral: { verifiedReferral: 10, sevenDayActive: 10, comradeBonus: 5 },
  contribution: { graphic: 25, research: 30, article: 30, feedback: 15, initiative: 40, significantMin: 50, significantMax: 100 },
} as const;
export const DAILY_LIMITS = { overpoints: 100, overcredits: 100, messagesRewarded: 10 } as const;
export const TICKET_CATEGORIES = ["General Inquiry","Partnerships","Business Development","Opportunities","Technical Support","Other"] as const;
export const INFO_PAGES = ["about","links","team","roadmap","updates","faq","opportunities","socials"] as const;
export const EARNING_CATEGORIES = ["community","social","referral","contribution"] as const;
export type EarningCategory = (typeof EARNING_CATEGORIES)[number];
export function isInternalRole(name: string): boolean { return (INTERNAL_ROLES as readonly string[]).includes(name); }
export function clamp(n: number, min: number, max: number): number { return Math.max(min, Math.min(max, n)); }
