# Overland Finance

The lightweight Discord bot is in \`bot/\`. It is a standalone JavaScript + Discord.js app with JSON storage. It does not require a database, Prisma, Redis, or the dashboard.

## Start the bot

\`\`\`bash
cd bot
npm install
cp .env.example .env
npm start
\`\`\`

Add \`DISCORD_TOKEN\` and \`DISCORD_CLIENT_ID\` to \`bot/.env\`. Set \`DISCORD_GUILD_ID\` for instant slash-command updates while testing. Commands sync automatically when the bot starts.

See [bot/README.md](bot/README.md) for the command list, Discord permissions, intents, storage, and branding details.

## Brand

Overland Finance uses emerald \`#00C982\`, lime \`#C5E86C\`, deep green-black, white, and muted grey. All bot embeds use one shared design system in \`bot/src/embeds.js\`.

The previous dashboard and TypeScript core remain in the repository as legacy code. The lightweight bot runs independently from them.
