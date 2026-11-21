# Overland Core - Architecture

## 1. Purpose

Overland Core is the central operating system for the Overland Finance
Discord community: one bot and one admin dashboard, backed by one
PostgreSQL database, covering roles, staff, a two-currency economy,
campaigns, referrals, rewards, leaderboards, achievements, verification,
tickets, moderation, X announcements and info pages. The design goal is
that every community action is recorded in the database and can be
audited, and that no public Discord role can ever grant administrative
power.

## 2. System overview (text diagram)

```text
                    Discord users
                         |
            +------------+-------------+
            |  Discord Gateway / API   |
            +------------+-------------+
                         |
              +----------+-----------+
              |  apps/bot (Node 20+)  |
              |  Discord.js v14       |
              |  commands, events,    |
              |  modules, jobs        |
              +-----+----------+------+
                    |          |
        +-----------+          +-----------+
        | Prisma Client (lazy) |  BullMQ / Redis
        |                      |  (in-memory fallback)
        +-----------+----------+-----------+
                    |
            +-------+--------+
            |  PostgreSQL    |
            |  25 tables,    |
            |  11 enums      |
            +-------+--------+
                    |
              +-----+------+
              | apps/      |
              | dashboard  |
              | Next.js 14 |
              | Discord    |
              | OAuth2     |
              +------------+
                    |
              Staff browsers (Discord sign-in)
```

Staff use the dashboard. Members use Discord slash commands. The bot
also reads the official Overland X timeline through the X API v2 and
announces new posts in Discord. Nothing in the system scrapes X.

## 3. Repository layout

```text
overland-core/
  apps/bot/            Discord bot (TypeScript, ESM, NodeNext)
    src/index.ts       Entrypoint: env check, login, dispatch, shutdown
    src/config/env.ts  zod env validation, fails fast on missing vars
    src/commands/      Slash command definitions and handlers
    src/deploy-commands.ts  Guild command registration script
    src/events/        GuildMemberAdd, MessageCreate handlers
    src/jobs/          Referral retention, X polling, snapshots
    src/lib/           Cross-cutting helpers (below)
    src/modules/       One folder per feature (below)
    src/tests/         Vitest suite plus the Prisma stub
  apps/dashboard/      Next.js 14 App Router dashboard
    app/               Pages for the 17 sections, API routes
    lib/auth.ts        Discord OAuth2, session cookie, RBAC helpers
    lib/prisma.ts      Dashboard Prisma client (global singleton)
  packages/shared/     Brand, roles, permission groups, point values
  prisma/
    schema.prisma      25 models, 11 enums, indexes, constraints
    migrations/20261120000000_init/migration.sql  Full DDL
    seed.ts            Roles, groups, permissions, achievements, config
  docs/                Setup, deployment, architecture, commands
```

## 4. Bot runtime

`apps/bot/src/index.ts` is the entrypoint:

1. `loadEnv()` validates the environment with zod. A missing required
   variable exits the process with a message naming the variable.
2. A Discord.js `Client` is created with intents Guilds, GuildMembers,
   GuildMessages, MessageContent and GuildInvites.
3. Commands are dispatched from a map built from
   `apps/bot/src/commands/index.ts`. A handler that throws is caught,
   logged, and answered with a generic error message; the error text is
   never leaked to the member.
4. Events and jobs are registered, then `client.login()` connects the
   Gateway.
5. `SIGINT` and `SIGTERM` shut down gracefully: disconnect Prisma,
   destroy the client, exit.

The bot registers no commands at startup. Registration is a separate
step (`npm --workspace apps/bot run deploy-commands`, guild scope only).

## 5. Shared library (`apps/bot/src/lib`)

| File | Responsibility |
| --- | --- |
| `db.ts` | Lazy Prisma client behind a Proxy, plus best-effort `audit()`. Importing this module never constructs a client, so unit tests and scripts that only need pure helpers do not need a generated client or a database. First use constructs the client; if generation never ran, it throws a clear error telling the operator to run `prisma generate`. |
| `points.ts` | Atomic point awards (`awardPoints`, idempotent on `idempotencyKey`, never negative), `getBalance`, `dailyEarned`, pure helpers `withinDailyLimit`, `computeDailyStreak`, `streakBonusFor`. |
| `permissions.ts` | `hasPermission(discordId, key)` and `isStaff(discordId)` against `InternalTeamMember` plus group permissions; pure `groupHasPermission` for tests. Owner group bypasses all checks. |
| `config.ts` | Database-backed configuration with an in-memory cache: `getConfig`, `getPointValues`, `getInfoContent`, `clearConfigCache`. |
| `antifraud.ts` | Pure helpers only: message hashing and duplicate detection, spam bursts, suspicious accounts, self-referral and burst detection, suspicious links, mention counting. No database, fully unit tested. |
| `embeds.ts` | Overland brand embeds: emerald #00C982, lime #C5E86C, dark backgrounds, white and muted grey type. |
| `logger.ts` | pino logger, level from `LOG_LEVEL`, pretty output in development. |
| `queue.ts` | `registerJob`, `startWorkers`, `enqueue` and graceful worker shutdown. With `REDIS_URL`, BullMQ workers execute durable delayed jobs; without it, in-memory timers are used and delayed jobs are lost on restart. |
| `x-client.ts` | Official X API v2 user timeline. Returns null when `X_BEARER_TOKEN` is not set, never fakes data. |

## 6. Feature modules (`apps/bot/src/modules`)

One folder per feature, each with a `service.ts` that holds the logic
and is imported by commands, events, jobs or the dashboard. Pure,
testable helpers live next to the database code in the same file so the
rules are in one place.

| Module | What it does |
| --- | --- |
| `roles` | Grant and revoke community roles, prerequisite checks (`meetsRoleRequirements`), role history. Internal roles are refused on this path; they are assigned through team management only. |
| `team` | Internal staff records: Discord ID, username, public role, job title, department, responsibilities, permission group, status, date added. |
| `economy` | Daily check-in, participation, helpful answers, events, weekly challenges, approved contributions. All awards go through the daily cap guard. |
| `campaigns` | Create and activate campaigns, submit work, staff review with atomic point award on approval, submission history and review queue. |
| `referrals` | Invite tracking, self-referral rejection, verification, 7-day retention job, Comrade conversion. |
| `rewards` | Reward catalog, atomic claim (debit plus stock decrement in one transaction, pending-claim dedupe, refund on rejection), claim review. |
| `leaderboards` | Lifetime (live balances) and monthly/weekly (snapshots) leaderboards, pagination, period keys, member rank. |
| `achievements` | Grant achievements atomically with their point rewards, check-and-grant after earning events, custom achievement creation (staff only). |
| `verification` | Short-lived CAPTCHA challenges, configurable account age/avatar requirements, anti-raid holds, member verification and staff bypass that grants Citizen. |
| `tickets` | Ticket creation with private channels, claim, first-response tracking, close with transcript, archive, reopen, add/remove members, rating. |
| `moderation` | Configurable spam, duplicate, suspicious-link, invite, mass-mention and profanity filters; warnings, timeouts, kicks, bans, unbans, purge, moderation history and reversible lockdown. |
| `x-integration` | Poll the X timeline, announce new posts, manual announcement, post history, pure dedupe and announce filters. |
| `settings` | Persistent HTTPS social links and welcome settings edited through slash commands. |
| `info` | Info page content served from `BotConfiguration`, editable in the dashboard, never hardcoded. |

## 7. Database

PostgreSQL through Prisma 5.22. The schema (`prisma/schema.prisma`)
has 25 models and 11 enums. The checked-in migration
(`prisma/migrations/20261120000000_init/migration.sql`) is full DDL:
every table with columns, types, defaults, primary keys, foreign keys,
unique constraints and indexes, verified field by field against the
schema. Key tables:

- Identity: `users`, `discord_members`, `roles`, `member_roles`,
  `role_history`.
- Staff: `internal_team_members`, `permission_groups`, `permissions`.
- Economy: `point_balances`, `point_transactions`.
- Engagement: `campaigns`, `campaign_submissions`, `referrals`,
  `rewards`, `reward_claims`, `achievements`, `member_achievements`,
  `daily_checkins`, `leaderboard_snapshots`.
- Operations: `tickets`, `ticket_messages`, `moderation_actions`,
  `x_posts`, `bot_configuration`, `audit_logs`.

Conventions in the DDL: `TEXT` for String, `TIMESTAMP(3)` for
DateTime with `DEFAULT CURRENT_TIMESTAMP` on `@default(now())`,
`JSONB` for Json, `DATE` for the check-in date, `SERIAL` for the ticket
number autoincrement. `@default(cuid())` ids have no database default;
the Prisma Client generates them. `@updatedAt` columns have no database
default either; the client sets them. Foreign keys carry the schema's
`onDelete` behaviour: `CASCADE` where the schema says so (for example
member rows, balances, transactions), `RESTRICT` for required relations
without a cascade (for example ticket owner, moderation target), and
`SET NULL` for the optional role prerequisite.

## 8. Economy invariants

These are the rules the code enforces, and the tests pin down:

- Overpoints are lifetime reputation. They are never spent and never
  decrease except by an explicit staff adjustment, which is audited.
- Overcredits are spendable. A claim debits them inside the same
  transaction that creates the claim and decrements stock, so a
  double claim cannot overspend. Balances never go below zero:
  `awardPoints` throws when the result would be negative.
- Every award and claim carries an `idempotencyKey`. Replaying the
  same key returns the existing transaction or claim instead of paying
  twice. Daily check-ins key on member plus date; campaign approvals
  on submission id; refunds on claim id.
- Daily earning is capped (default 100 Overpoints per day, from
  `BotConfiguration` dailyLimits). Participation is rewarded per
  message id, at most 10 rewarded messages per member per day, so raw
  message volume cannot be farmed.
- Point values are configuration, not code: `DEFAULT_POINT_VALUES` in
  `packages/shared` is the seed default, and the live values live in
  the `pointValues` configuration row, editable in the dashboard.

## 9. Roles and permissions

Public Discord roles and internal permissions are separate systems by
design:

- Public roles (Citizen, Comrade, Socialite, Creator, Intellect,
  Pioneer, Luminary, plus internal Founder, Admin, Warden as display
  roles) are stored in `roles` and granted in `member_roles` with a
  history row in `role_history`. Citizen is granted after verification.
  Comrade requires Citizen plus a verified X follow (staff verified or
  integration verified). Socialite, Creator and Intellect are earned
  through milestones and approved contributions. Pioneer is for early
  members. Luminary is staff-awarded.
- Internal positions live in `internal_team_members`, each linked to a
  `permission_groups` row (Owner, Executive, Administration,
  Moderation, Development, Support, Rewards_Management). Permissions
  are granular keys such as `moderation.action`, `economy.adjust`,
  `campaigns.review`, `rewards.manage`, `tickets.manage`, `x.manage`,
  `config.manage`. The Founder is the Owner group and bypasses all
  checks. Admin and Warden are configurable groups, not hardcoded
  powers.
- A public role never grants a permission. `hasPermission` only reads
  the internal team record and its group. Removing the team record or
  setting its status to INACTIVE revokes access immediately.
- Discord role IDs are never hardcoded. The mapping from an Overland
  Core role to a Discord role id lives in `roles.discordRoleId` and is
  set in the dashboard.

## 10. Internal team

Each staff record carries Discord ID, username, public role, internal
job title, department, responsibilities, permission group, status
(ACTIVE, INACTIVE, SUSPENDED, REMOVED) and date added. Staff records
are private: no command and no dashboard page exposes them to ordinary
members.

Bootstrap problem: the seed creates permission groups but no staff
record, so the very first Owner must be inserted directly in the
database, for example:

```sql
-- Run only after the member has joined and been verified, and only by
-- someone with database access. Replace the ids with real ones.
INSERT INTO internal_team_members
  (id, "memberId", "discordId", username, "publicRole", "jobTitle",
   department, "groupId", status, "addedAt", "updatedAt")
SELECT '...', dm.id, 'DISCORD_ID', 'username', 'Founder',
  'Founder', 'Leadership', pg.id, 'ACTIVE', now(), now()
FROM discord_members dm, permission_groups pg
WHERE dm."userId" = (SELECT id FROM users WHERE "discordId" = 'DISCORD_ID')
  AND pg.name = 'Owner';
```

Prefer a short-lived admin script or a dashboard bootstrap step over
hand-written SQL in production; the SQL above is the fallback when
neither exists yet.

## 11. Jobs and scheduling

Jobs are registered in `apps/bot/src/jobs/index.ts` and run inside the
bot process, not as separate cron jobs:

- `referral-retention`: 7 days after a verified referral, marks the
  referral retained and awards the 10 point retention bonus.
- `x-poll`: polls the X timeline immediately at startup and every
  15 minutes after. The job id includes the hour, so a restart does
  not double-poll the same hour.
- `leaderboard-snapshot`: writes monthly and weekly top-100 snapshots.
  Re-running for the same period key replaces the old rows, so the job
  is idempotent and duplicate jobs cannot double count.

`enqueue` dedupes by idempotency key in memory, and BullMQ dedupes by
job id when Redis is configured. There is no separate scheduler process
to keep in sync, and no job should be scheduled twice from two places.

## 12. X integration

`apps/bot/src/lib/x-client.ts` calls the official X API v2 user
timeline for the configured username, requesting tweet fields for
referenced tweets and media. `apps/bot/src/modules/x-integration/service.ts`
then:

1. Skips replies and reposts when configured (default: skip both).
2. Skips posts already announced, deduped by `postId` in the `x_posts`
   table (unique constraint) and by the pure `filterNewXPosts` helper.
3. Posts the rest to the configured announcement channel as a branded
   embed with the post text, a link, and the first image where present.
4. Records every post with its announcement channel and time, keeping
   a full history for the dashboard.

If `X_BEARER_TOKEN` is missing or the integration is disabled in
configuration, polling returns early and logs why. Manual announcement
(`/x-announce`, staff only, `x.manage`) parses the post id from the URL,
dedupes against `x_posts`, and uses the live timeline text when the API
can fetch it. When the API cannot fetch it, the record keeps the URL
and empty text rather than invented copy. Limitations: the integration
depends on X API v2 access and its rate limits; it cannot see posts
from protected accounts, and it cannot announce a post the API does
not return.

## 13. Dashboard

Next.js 14 App Router in `apps/dashboard`, 17 sections: Overview,
Members, Public Roles, Internal Team, Permissions, X Integration,
Welcome and Verification, Moderation and Security, Tickets, Points and
Economy, Social Campaigns, Referrals, Rewards, Leaderboards,
Achievements, Analytics, Bot Configuration.

Authentication is Discord OAuth2. The callback exchanges the code for
an access token, fetches `/users/@me`, then looks up the staff record.
The session is a base64 JSON cookie (`overland_session`, httpOnly,
secure in production, 24 hour lifetime) carrying Discord id, username,
permission group and permission keys. API routes call `requireStaff`
with the permission key they need; a non-staff user gets a session with
a null group and a 403 on every admin route. The dashboard has its own
Prisma client singleton (`apps/dashboard/lib/prisma.ts`).

## 14. Configuration

Almost nothing about the community is hardcoded. `BotConfiguration`
(key plus JSON value) holds point values, daily limits, verification
rules, moderation rules, X integration settings, info page content and
welcome settings. The dashboard edits these rows; the bot caches them
in memory and `clearConfigCache` invalidates the cache. Company
information for `/about`, `/links`, `/team`, `/roadmap`, `/updates`,
`/faq`, `/opportunities` and `/socials` comes from the `infoContent`
row, so updating the website copy never needs a code deploy.

## 15. Testing

Vitest, in `apps/bot`. The suite (42 tests) covers pure rules: daily
limits, point values, atomicity invariants, reward-claim guard, daily
streak logic, leaderboard pagination, X dedupe, ticket numbering,
referral anti-abuse, role requirements, permissions, spam and duplicate
detection, verification, transcripts and leaderboard fields. The suite
runs with no database and no generated Prisma Client, using a stub
(`apps/bot/src/tests/prisma-stub.ts`) and lazy client initialisation.
Typecheck is `tsc --noEmit` on the bot project and must exit 0.

Open gaps, stated plainly rather than hidden:

- There are no integration tests against a live PostgreSQL database.
  The atomicity of `awardPoints` and `claimReward` is covered by unit
  tests of the guard logic and by the transaction structure, not by a
  test that runs two concurrent claims against Postgres. Add that
  before calling the economy production-proven.
- `prisma generate` and `prisma validate` need network access to the
  Prisma binary host and have failed in this workspace with ECONNRESET
  (see docs/SETUP.md section 5). Until generate succeeds on the deploy
  host or in CI, the database layer cannot be exercised at runtime.
- The dashboard session cookie is HMAC-signed (SHA-256) with
  `DASHBOARD_SESSION_SECRET` (falling back to `NEXTAUTH_SECRET`). Unsigned or
  tampered cookies are rejected, and login fails loudly if no secret is set.
- `/ticket-close` is gated: only staff with `tickets.manage`, or the member who
  opened the ticket, can close it.
- The dashboard team API reads `DISCORD_GUILD_ID` first, with `GUILD_ID` kept
  only as a legacy fallback, so only one guild id needs to be set.

## 16. Key invariants (summary)

- Public Discord roles never grant administrative permissions.
- Overpoints are lifetime and non-spendable; Overcredits are spendable
  and never go negative.
- Point awards and reward claims are atomic and idempotent.
- No Discord, channel or role IDs are hardcoded.
- No credentials are stored in the database.
- The bot is one persistent Gateway process, never serverless.
- The X integration uses the official API only, never scraping.
