# Overland Finance Discord Bot

Plain JavaScript, Discord.js v14, JSON persistence. No PostgreSQL, Prisma, Redis, TypeScript, or dashboard dependency for the bot runtime.

## Hosting setup

You can host from either the repository root or the `bot/` directory. The root package now includes the bot as a workspace.

**From repository root:** install `npm install`, startup `npm start`.

**If the host supports a bot subdirectory:** set root directory to `bot`, install `npm install`, startup `npm start`.
- Node.js: 20 or newer
- Persistent data directory: `bot/data/` (contains `overland.json`)

Add these environment variables in the hosting panel:
- `DISCORD_TOKEN`: bot token from Discord Developer Portal.
- `DISCORD_CLIENT_ID`: Application ID, not the bot token or server ID.
- `DISCORD_GUILD_ID`: Your test server ID. Strongly recommended while setting up.
- `OVERLAND_OWNER_DISCORD_ID`: Your Discord user ID to bootstrap the first Owner.
- `OVERLAND_OWNER_USERNAME`: Optional display name.
- `X_BEARER_TOKEN`: Optional X API bearer token.

The bot loads all command modules and registers them automatically after connecting. From the repository root, run `npm run register:commands` to register manually; from `bot/`, run `npm run register`.

## Why slash commands sometimes do not appear

1. Invite the bot using both OAuth scopes: `bot` and `applications.commands`.
2. Make sure `DISCORD_CLIENT_ID` is the Application ID belonging to the exact token in `DISCORD_TOKEN`.
3. Set `DISCORD_GUILD_ID` to the server ID where you are testing. Guild commands appear quickly; global commands can take up to an hour.
4. Re-invite the bot if the original invite did not include `applications.commands`.
5. Read startup logs. The bot prints the command count, target application/guild, HTTP status, and Discord error code if registration fails.
6. Do not run multiple bot copies with different tokens or app IDs against the same server while testing.

## Commands

Commands are individual files under `src/commands/<category>/`. The loader recursively discovers every `.js` command file. Each file exports a default object with a SlashCommandBuilder and an execute function. No central command list needs editing.

Categories include moderation, roles, economy, campaigns, rewards, referrals, community, and admin.

## Systems

- Internal team permission groups with Owner bootstrap; public roles never grant internal permissions.
- Citizen verification, Comrade X-follow verification, role history, role progression and Discord role mappings.
- Overpoints and Overcredits, daily check-ins, streak bonuses, category balances, daily earning limits and transaction history.
- Campaign creation, submissions, staff review and automatic category rewards.
- Reward catalogue, Overcredit claims, staff approval/rejection and automatic refunds.
- Referral invite tracking, verification rewards, seven-day retention and Comrade conversion bonuses.
- Lifetime, weekly and monthly leaderboards; profiles and achievements.
- Editable information pages and social links, welcome messages, tickets, moderation logs, analytics, polls, spotlight and X announcements.

## Important storage note

The JSON file is suitable for a single running bot instance on a host with persistent disk. Do not run multiple bot instances against the same JSON file. If the host wipes its filesystem on restart, attach persistent storage or back up `data/overland.json`.
