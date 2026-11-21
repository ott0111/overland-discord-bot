# Overland Core - Setup

This guide takes a fresh checkout to a running bot and dashboard. It assumes
you have already read the README. Times are approximate: about 30 minutes
with credentials in hand, plus whatever time Discord and PostgreSQL setup
takes on your machine.

## 1. Prerequisites

- Node.js 20 or newer (`node --version`). The repo engines field requires
  Node 20+. Use the LTS release if you are unsure.
- npm 10 or newer (ships with Node 20).
- PostgreSQL 15 or newer, running locally or hosted, with a database and a
  user that can create tables, types and indexes.
- Redis 7 or newer (recommended). With Redis, BullMQ workers execute durable
  delayed jobs and scheduled X polling. Without Redis, the bot uses an
  in-memory timer fallback; delayed jobs are lost on restart.
- A Discord account with permission to create applications and to add a bot
  to the Overland Finance server.
- For X integration only: an X developer account with API v2 access and a
  bearer token for the official Overland Finance X account. Without it the
  integration stays disabled and the bot says so in its logs. It never
  scrapes X and never invents posts.
- For the dashboard only: the Discord OAuth2 redirect URL must be reachable
  by staff browsers (localhost works for local development).

## 2. Create the Discord application

1. Open https://discord.com/developers/applications and click New
   Application. Name it `Overland Core`.
2. Copy the Application ID. This is `DISCORD_CLIENT_ID`.
3. Go to Bot, click Reset Token, and copy the token. This is
   `DISCORD_TOKEN`. Treat it like a password. It is shown once.
4. On the same Bot page, enable these Privileged Gateway Intents:
   - Server Members Intent (needed for joins, verification and roles)
   - Message Content Intent (needed for spam, phishing and participation
     detection)
   - Guild Invites is not a privileged intent, but the bot requests the
     GuildInvites gateway intent at login, so invite tracking works once
     the bot is in the server.
5. Go to OAuth2, URL Generator. Select scopes `bot` and
   `applications.commands`. Select at least these bot permissions:
   Manage Roles, Manage Channels, Kick Members, Ban Members, Moderate
   Members (timeout), Manage Messages, Read Message History, Send Messages,
   Embed Links, Attach Files, Create Invite, View Channels. The bot only
   uses the permissions its features need, and staff actions are gated by
   the internal permission system, not by Discord roles.
6. Open the generated URL, pick the Overland Finance server, and authorize.
   Note the server (guild) ID. In Discord, enable Developer Mode
   (Settings, Advanced), right click the server name, Copy Server ID.
   This is `DISCORD_GUILD_ID`.
7. Still in OAuth2, General: add a redirect URI for the dashboard:
   - Local development: `http://localhost:3000/api/auth/callback`
   - Production: `https://<your-dashboard-domain>/api/auth/callback`
   Copy the Client Secret. This is `DISCORD_CLIENT_SECRET`. It is only
   used by the dashboard OAuth2 exchange, never by the bot.
8. Move the bot role above the community roles it must manage in Server
   Settings, Roles. Discord will not let a bot assign a role above its own
   highest role. The bot creates no Discord roles itself; staff create the
   roles (Founder, Admin, Warden, Pioneer, Luminary, Creator, Intellect,
   Socialite, Comrade, Citizen) in Discord and map them to Overland Core
   roles in the dashboard by pasting each role ID into the role record
   (`discordRoleId`).

## 3. Environment variables

Copy the template and fill it in. Never commit the real file.

```sh
cp .env.example .env
```

| Variable | Required | Used by | Notes |
| --- | --- | --- | --- |
| `DISCORD_TOKEN` | Yes | Bot | Bot token from step 2. Startup fails fast without it. |
| `DISCORD_CLIENT_ID` | Yes | Bot, dashboard | Application ID. |
| `DISCORD_CLIENT_SECRET` | Yes for dashboard | Dashboard | OAuth2 client secret. The bot accepts an empty value. |
| `DISCORD_GUILD_ID` | Yes | Bot | Server ID the bot operates in. |
| `GUILD_ID` | No | Dashboard team API | Legacy fallback only. The team route reads `DISCORD_GUILD_ID` first, so you do not need to set this. |
| `DATABASE_URL` | Yes | Bot, dashboard, Prisma | PostgreSQL connection string, for example `postgresql://overland:SECRET@localhost:5432/overland_core?schema=public`. |
| `REDIS_URL` | No | Bot | For example `redis://localhost:6379`. Enables BullMQ workers and durable delayed jobs. Without it, delayed jobs use in-memory timers and are lost on restart. |
| `X_BEARER_TOKEN` | No | Bot | X API v2 bearer token. Blank means the X integration is disabled and logs that clearly. |
| `X_USERNAME` | No | Bot | Defaults to `OverlandFinance`. |
| `NEXTAUTH_URL` | Yes for dashboard | Dashboard | Public base URL of the dashboard, for example `http://localhost:3000` locally. The OAuth2 redirect is this URL plus `/api/auth/callback`. |
| `NEXTAUTH_SECRET` | Yes for dashboard | Dashboard | Fallback signing secret for the HMAC-protected dashboard session cookie. |
| `DASHBOARD_SESSION_SECRET` | Yes for dashboard | Dashboard | Preferred HMAC-SHA256 session signing secret. Use a long random value unique to each environment. |
| `NODE_ENV` | No | Bot, dashboard | `development` or `production`. Defaults to `development`. |
| `LOG_LEVEL` | No | Bot | pino log level. Defaults to `info`. |
| `PORT` | No | Dashboard host | Port for `next start`. Next.js reads it natively. Defaults to `3000`. |

Generate random secrets with `openssl rand -base64 32`. Never reuse a
secret across environments, and never paste a real token into chat, a
ticket, or a screenshot.

## 4. Install dependencies

From the repo root:

```sh
npm install
```

This installs the root Prisma CLI plus the `apps/bot`, `apps/dashboard`
and `packages/shared` workspaces. If install fails on network access,
retry once; the npm registry is the only network dependency at this step.

## 5. Generate the Prisma Client

```sh
npx prisma generate --schema prisma/schema.prisma
```

This step downloads the Prisma engine binaries, so it needs network
access to the Prisma binary host. If it fails, retry up to three times;
transient resets have been seen in this environment. The exact failure
seen on 2026-11-20 in this workspace was:

```text
Error: aborted
    at TLSSocket.socketCloseListener (node:_http_client:734:19)
    ...
  code: 'ECONNRESET',
  attemptNumber: 1,
  retriesLeft: 2
```

That error comes from the Prisma CLI itself, not from the schema: the
schema validates logically, but the CLI could not download its engine.
A retry with the mirror sometimes helps:

```sh
PRISMA_ENGINES_MIRROR=https://binaries.prisma.sh npx prisma generate --schema prisma/schema.prisma
```

Do not fake a generated client. Until `prisma generate` succeeds, the
bot cannot talk to the database at runtime (importing the database layer
is safe; the first real query throws a clear error telling you to run
generate), and `prisma validate` cannot run either, because the same CLI
download is involved. Unit tests do not need this step: they run against
a stub client, see step 9.

## 6. Create the database schema

Apply the checked-in migration. It contains full DDL for all 25 tables,
11 enum types and 23 foreign keys, matching `prisma/schema.prisma`
field by field:

```sh
npx prisma migrate deploy --schema prisma/schema.prisma
```

`migrate deploy` is the command for shared and production databases: it
applies pending migrations and never generates a new one. For a first
local setup against an empty database, `npx prisma db push` is an
acceptable alternative, but do not use `db push` on a shared database:
it can drift the schema away from the migration history.

Verify the result in PostgreSQL:

```sql
SELECT count(*) FROM information_schema.tables
  WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
-- expected: 25 (plus _prisma_migrations, which Prisma manages itself)

SELECT count(*) FROM pg_type WHERE typtype = 'e';
-- expected: 11 enum types
```

If the count is wrong, do not edit the database by hand. Fix
`prisma/schema.prisma` and the migration file, then re-run deploy.

## 7. Seed the database

```sh
npm run db:seed
```

The seed is idempotent (upserts only) and safe to re-run. It creates:

- The 10 official roles: Founder, Admin, Warden (internal), Pioneer,
  Luminary, Creator, Intellect, Socialite, Comrade, Citizen. Comrade is
  linked to require Citizen.
- The 7 permission groups (Owner, Executive, Administration, Moderation,
  Development, Support, Rewards_Management) and all 20 permission keys,
  attached to the Owner group.
- 6 achievements: first-verification, first-contribution, first-referral,
  first-social, streak-7, streak-30.
- Default `BotConfiguration` rows: pointValues, dailyLimits
  (100 Overpoints and 100 Overcredits per day), verification
  (minimum account age 7 days, captcha required), moderation
  (profanity and invite filters on, 5 mentions max, 5 messages per
  10 seconds), xIntegration (disabled, username OverlandFinance,
  replies and reposts ignored, 15 minute poll), infoContent (about,
  links, team, roadmap, updates, faq, opportunities, socials), welcome
  (enabled, welcome DMs off).

The seed creates no staff record and no Discord roles. The first staff
member must be added in the database or dashboard by someone who already
has access; see docs/ARCHITECTURE.md, Internal team, for the bootstrap
note. Until at least one Owner exists, no dashboard admin function works.

## 8. Register the slash commands

```sh
npm --workspace apps/bot run deploy-commands
```

This registers all guild commands in `DISCORD_GUILD_ID` only. Guild
registration updates within seconds; global registration would take up
to an hour, which is why the bot uses guild commands. Re-run this after
any change to `apps/bot/src/commands/index.ts`. See docs/COMMANDS.md
for the full list.

## 9. Run the bot and the dashboard

Development, two terminals from the repo root:

```sh
npm run dev:bot        # tsx watch apps/bot/src/index.ts
npm run dev:dashboard  # next dev on http://localhost:3000
```

Production build (bot and dashboard):

```sh
npm run build
npm --workspace apps/bot run start
npm --workspace apps/dashboard run start
```

On startup the bot validates its environment with zod and exits with a
clear message naming the missing variable if anything required is
absent. A successful start logs `Overland Core is running. Gateway
connected.` The bot is a persistent Gateway process: do not run it as a
serverless function, and do not run two copies with the same token (see
docs/DEPLOYMENT.md).

## 10. Verify the setup

1. In Discord, run `/help`. All commands should be listed.
2. As a staff member with `config.manage`, run `/link add` to save a social link, then `/socials` to publish the embed and URL buttons.
3. Run `/welcome setup` to select the welcome channel and customize its title and message. Use `/welcome preview` before testing a join.
4. Run `/security status` to inspect automatic moderation. Staff with `moderation.action` can adjust it with `/security configure`.\n2. As a staff member with `config.manage`, run `/link add` to save a social link, then `/socials` to publish the embed and URL buttons.\n3. Run `/welcome setup` to select the welcome channel and customize its title and message. Use `/welcome preview` before testing a join.\n4. Run `/security status` to inspect automatic moderation. Staff with `moderation.action` can adjust it with `/security configure`.
2. Run `/profile`. You should see your balances (0 Overpoints,
   0 Overcredits) and rank.
3. Run `/daily`. You should earn 5 Overpoints and a streak of 1 day.
   Run it again: it should say you already checked in today.
4. Run `/leaderboard overall`. You should appear on it.
5. Open http://localhost:3000 and sign in with Discord. If you are not
   staff, you will see a staff-only message: that is the RBAC working.
   A staff member sees the dashboard sections.
6. Check the X integration state in the bot log at startup: with no
   `X_BEARER_TOKEN` it logs that X polling is skipped. With a token and
   the integration enabled in configuration, the first poll runs
   immediately and then every 15 minutes.

## 11. Tests, typecheck and CI

No database and no generated Prisma Client are needed for these:

```sh
npm test                 # bot Vitest suite
npm run typecheck        # bot and dashboard TypeScript checks
npm run build            # bot and dashboard production builds
```

The bot tests cover daily limits, point values, atomicity invariants,
reward-claim guard, daily streak logic, leaderboard pagination,
X dedupe by postId, ticket numbering, referral anti-abuse, role
requirements, permissions, spam and duplicates, verification, tickets
and leaderboards. They run against a Prisma stub
(`apps/bot/src/tests/prisma-stub.ts`) wired through `vitest.config.ts`,
and the database layer uses lazy initialisation
(`apps/bot/src/lib/db.ts`), so importing it never constructs a client.
Tests that need a live database do not exist yet; that is an open gap,
see docs/ARCHITECTURE.md.

A GitHub Actions workflow at `.github/workflows/ci.yml` runs Prisma\ngeneration and validation, both TypeScript checks, the bot tests and\nthe full production build on pushes and pull requests.\n\nA GitHub Actions workflow at `.github/workflows/ci.yml` runs Prisma
generation and validation, both TypeScript checks, the bot tests and
the full production build on pushes and pull requests.

## 12. Troubleshooting

- `Missing or invalid environment configuration: ...` at bot startup:
  a required variable from the table in section 3 is missing or empty.
  The message names it. Check `.env` is in the repo root, not in
  `apps/bot`.
- `Prisma Client is not available. Run npx prisma generate ...`:
  generate has not succeeded. See section 5. Do not hand-edit
  `node_modules/.prisma`.
- `ECONNRESET` from any `prisma` command: the Prisma CLI could not
  reach its binary host. Retry, try the mirror in section 5, and check
  outbound network access. The schema and migration are unaffected.
- `P1001` or `P1000` from Prisma at runtime: PostgreSQL is unreachable
  or the credentials in `DATABASE_URL` are wrong. Check the host, port,
  database name and password, and that PostgreSQL accepts TCP
  connections from this machine.
- Commands do not appear in Discord: re-run deploy-commands, confirm
  `DISCORD_GUILD_ID` is the server you are looking at, and wait a few
  seconds. Guild commands do not need an hour, but Discord can cache
  the list briefly.
- Bot is online but does nothing on `/daily`: check the bot log for a
  database error, and confirm the migration and seed ran against the
  same database `DATABASE_URL` points at.
- Dashboard sign-in loops or shows staff-only for a staff member: the
  Discord user must have an `InternalTeamMember` row with status
  ACTIVE. Check the row exists and the `discordId` matches exactly.
- X posts never appear: confirm `X_BEARER_TOKEN` is set, the
  `xIntegration` configuration row has `enabled: true` and a channel
  configured, and the token has API v2 user-timeline access. Without
  those, the integration is off by design and logs why.
