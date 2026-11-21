# Overland Finance

Overland Finance has a standalone Discord bot written in plain JavaScript and Discord.js v14 in `bot/`. The bot uses local JSON storage and does not require Prisma, PostgreSQL, Redis, or the dashboard to run.

The separate admin dashboard remains in `apps/dashboard` and continues to use the Prisma/PostgreSQL backend.

## Run the Discord bot

```bash
cd bot
npm install
cp .env.example .env
npm run check
npm start
```

Add `DISCORD_TOKEN` and `DISCORD_CLIENT_ID` to `bot/.env`. Set `DISCORD_GUILD_ID` for instant slash-command updates while testing. Commands sync automatically when the bot starts.

See [bot/README.md](bot/README.md) for commands, Discord permissions, intents, storage, and branding.

## Run the dashboard

The dashboard is separate from the bot. Configure the root `.env`, install root dependencies, run the Prisma migrations, then use `npm run dev:dashboard`. See [docs/SETUP.md](docs/SETUP.md).

## Repository structure

- `bot/`: JavaScript Discord bot with JSON configuration storage.
- `apps/dashboard/`: Next.js admin dashboard.
- `packages/shared/`: shared brand and application definitions.
- `prisma/`: schema and migrations used by the dashboard.
- `docs/`: setup, deployment, commands, architecture, and community-system documentation.

## Brand

Emerald `#00C982`, lime `#C5E86C`, deep green-black, white, and muted grey. Bot embeds use the shared design system in `bot/src/embeds.js`.
