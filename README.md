# Overland Core

Central operating system for the Overland Finance Discord community. Discord bot (persistent Gateway process, Discord.js v14, TypeScript), PostgreSQL + Prisma, Next.js admin dashboard with Discord OAuth2 and RBAC, BullMQ/Redis jobs with in-memory fallback.

## Quick start

1. Copy `.env.example` to `.env` and fill in credentials (see docs/SETUP.md).
2. `npm install`
3. `npx prisma migrate deploy` (or `prisma db push` for first setup) then `npm run db:seed`
4. `npm --workspace apps/bot run deploy-commands`
5. `npm run dev:bot` in one terminal, `npm run dev:dashboard` in another.

## Structure

- `apps/bot` Discord bot, editable setup commands, moderation, modules, events, durable jobs, tests
- `apps/dashboard` Next.js admin dashboard (17 sections)
- `packages/shared` Brand, roles, permissions, point values
- `prisma` Schema, initial migration, seed
- `docs` Setup, deployment, commands, architecture

## Brand

Emerald #00C982, Lime Yellow #C5E86C, dark backgrounds, white and muted grey type. No em dash character in bot content.

## Editable Discord configuration

Staff can manage saved HTTPS links with `/link add`, `/link edit` and `/link remove`; `/socials` publishes them as a branded embed with URL buttons. `/welcome setup`, `/ticket-setup`, `/verification-setup`, `/x-setup` and `/security configure` manage persistent settings without source edits. See [docs/COMMANDS.md](docs/COMMANDS.md).

## Credentials required

Discord bot token, Discord client ID and secret, guild ID, PostgreSQL URL, Redis URL (optional), X bearer token (optional, required only for X integration).


## Community system

See [docs/COMMUNITY_SYSTEM.md](docs/COMMUNITY_SYSTEM.md) for role definitions, internal permissions, earning values, daily limits, referrals, rewards, campaigns, leaderboards, X integration and first-time setup.
