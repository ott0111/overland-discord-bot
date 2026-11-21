# Overland Finance Discord Bot

A lightweight Discord.js bot for Overland Finance. The bot is plain JavaScript and stores server settings in a local JSON file. It does not need Prisma, PostgreSQL, Redis, or a dashboard to run.

## Run it

1. Use Node.js 20 or newer.
2. Open this folder: \`cd bot\`
3. Install dependencies: \`npm install\`
4. Copy \`.env.example\` to \`.env\` and add your Discord bot token and application client ID.
5. Start the bot: \`npm start\`

Slash commands are synced automatically when the bot starts. Set \`DISCORD_GUILD_ID\` while testing so updates appear in that server immediately. Without it, commands are registered globally and can take longer to appear.

## Commands

- \`/setup\` - view current server configuration
- \`/autorole set\` and \`/autorole clear\`
- \`/welcome set\` and \`/welcome disable\`
- \`/modlog set\` and \`/modlog disable\`
- \`/ticket-setup\` - publish the branded ticket panel
- \`/analytics\` - view member, join, leave, and message totals
- \`/warn\`, \`/kick\`, \`/ban\`, \`/timeout\`, \`/purge\`

## Discord setup

Invite the bot with the \`bot\` and \`applications.commands\` scopes. Grant only the permissions it needs: View Channels, Send Messages, Embed Links, Read Message History, Manage Roles, Manage Channels, Kick Members, Ban Members, Moderate Members, and Manage Messages.

Enable the **Server Members Intent** in the Discord Developer Portal for auto roles and welcome messages. Message Content Intent is not required.

Place the bot's highest role above any role it needs to assign or moderate.

## Data and branding

Settings and basic analytics are stored in \`bot/data/guilds.json\`. Keep this folder on persistent storage and back it up if you need to preserve configuration between host migrations.

Embeds use the Overland Finance palette:
- Emerald: \`#00C982\`
- Lime: \`#C5E86C\`
- Deep green-black surfaces, white text, and muted grey supporting text

The embed helper lives in \`src/embeds.js\`, so the visual style stays consistent across welcome messages, tickets, moderation logs, analytics, and setup replies.
