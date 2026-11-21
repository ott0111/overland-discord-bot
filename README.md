# Overland Finance

Overland Finance uses a standalone Discord bot written in plain JavaScript in `bot/`. The bot stores community data in JSON and does not require a database to run.

## Start the bot

```bash
cd bot
npm install
cp .env.example .env
npm start
```

Set `DISCORD_TOKEN`, `DISCORD_CLIENT_ID`, and `DISCORD_GUILD_ID` in `bot/.env`. The bot automatically loads commands from `bot/src/commands/<category>/` and registers them after connecting.

See [bot/README.md](bot/README.md) for hosting setup, command registration troubleshooting, permissions, and the feature list.

## Repository structure

- `bot/`: JavaScript Discord bot and JSON storage.
- `apps/dashboard/`: separate Next.js dashboard.
- `packages/shared/`: shared definitions.
- `prisma/`: dashboard data schema and migrations.
- `docs/`: setup, deployment, architecture, and community-system documentation.

The TypeScript Discord bot workspace has been removed. The dashboard and its Prisma schema remain separate from the bot runtime.
