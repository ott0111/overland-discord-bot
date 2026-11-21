# Overland Core - Deployment

## 1. What gets deployed, and where

Overland Core is two processes plus one database:

| Piece | What it is | Where it runs |
| --- | --- | --- |
| Bot | Long-lived Discord Gateway process (Discord.js v14, TypeScript, Node 20+) | Exactly one instance, on a VPS, a container host, Railway, or Render |
| Dashboard | Next.js 14 app (App Router) | Vercel, or any Node host |
| Database | PostgreSQL 15+ | Managed Postgres (Railway, Render, Neon, Supabase) or a VPS |
| Queue (optional) | Redis 7+ for BullMQ delayed jobs | Same host as the database, or managed Redis |

The bot must run as a persistent process with a reliable Gateway
connection. Do not deploy the bot as a serverless function, a cron job,
or a Vercel function: the Gateway connection must stay open, and a
short-lived function cannot hold it. The dashboard, by contrast, is a
normal stateless Next.js app and deploys well on Vercel.

Run exactly one bot instance per token. Two processes logged in with the
same token fight over the Gateway session, drop each other's connections,
and can trigger Discord rate limits. If you need redundancy, run one
active bot and keep a second host ready to start manually, never both
at once.

## 2. Release checklist (every deploy)

1. `npm install` on the deploy host (or bake it into the image).
2. `npx prisma generate --schema prisma/schema.prisma` on the deploy
   host. This needs network access to the Prisma binary host at build
   time. If your host blocks it, generate the client in CI where the
   network is open and ship the generated files with the build artifact.
3. `npx prisma migrate deploy --schema prisma/schema.prisma` against the
   production database. Run this before starting the new bot, never
   after, and never run `prisma migrate dev` or `prisma db push`
   against production.
4. `npm run db:seed` only on first setup. The seed is idempotent, so
   re-running it is safe, but it is not needed on every deploy.
5. `npm --workspace apps/bot run deploy-commands` after any command
   change. Command registration is a deploy step, not a startup step:
   the bot does not register commands when it starts.
6. `npm run build`, then start the bot and the dashboard.
7. Verify: bot logs `Overland Core is running. Gateway connected.`,
   `/help` works in Discord, the dashboard loads, and a staff sign-in
   succeeds.

## 3. VPS deployment with systemd (recommended for the bot)

Build once, then run the compiled output. Example unit file
`/etc/systemd/system/overland-core.service`:

```ini
[Unit]
Description=Overland Core Discord bot
After=network.target postgresql.service
Wants=postgresql.service

[Service]
Type=simple
User=overland
WorkingDirectory=/opt/overland-core
EnvironmentFile=/opt/overland-core/.env
ExecStart=/usr/bin/node apps/bot/dist/index.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
```

Then:

```sh
sudo systemctl daemon-reload
sudo systemctl enable --now overland-core
sudo journalctl -u overland-core -f   # follow the logs
```

Notes:

- Keep `.env` readable only by the service user (`chmod 600`) and
  outside the web root. Never commit it.
- `Restart=always` recovers from crashes and from Discord disconnects
  the bot does not recover from itself, but it also restarts a bot that
  exits on a configuration error. If the service restarts in a loop,
  read the journal first: a missing env var or a bad `DATABASE_URL`
  will fail the same way every time.
- `WorkingDirectory` matters: the bot reads its config from the
  environment, but relative paths in scripts assume the repo root.
- Deploy the dashboard on the same VPS with `next start`, or on Vercel
  (section 5). If it shares the VPS, run it as a second systemd unit
  with its own `EnvironmentFile` and `PORT`.

## 4. PM2 deployment (alternative to systemd)

```sh
npm run build
pm2 start npm --workspace apps/bot --name overland-core -- run start
pm2 save
pm2 startup   # follow its printed instructions once
```

Use PM2 when systemd is unavailable (for example on some shared VPS
plans). Keep the same rules: one instance, env from a secured file
(`pm2 start ... --env production` reads `ecosystem.config.js`, so put
secrets there only if that file is protected and not committed), and
`pm2 logs overland-core` for troubleshooting. `pm2 restart overland-core`
is the manual restart; `pm2 stop overland-core` is the manual stop.

## 5. Railway and Render

### Railway

1. Create a Railway project from the repo. Add a PostgreSQL service and
   a Redis service from the Railway catalog.
2. Create a service for the bot from the same repo, with the start
   command `npm run build && npm --workspace apps/bot run start`.
   Set the service to run continuously (Railway services are long-lived
   by default; do not use a Railway cron for the bot).
3. Create a second service for the dashboard with the start command
   `npm --workspace apps/dashboard run start` and the root directory
   left at the repo root (the dashboard needs the workspace). Or deploy
   the dashboard on Vercel and keep only the bot and database on
   Railway.
4. Set variables on each service from the table in docs/SETUP.md
   section 3. Railway injects `DATABASE_URL` and `REDIS_URL` from its
   own services automatically if you reference them; otherwise paste
   the values. `NEXTAUTH_URL` must be the public dashboard URL.
5. Add a deploy hook or a manual step for `npx prisma migrate deploy`
   before the first start, and on every release that ships a migration.

### Render

1. Create a PostgreSQL instance and a Redis (Key Value) instance.
2. Create a Background Worker for the bot (not a Web Service: a Web
   Service expects an HTTP port and Render will restart it for not
   listening). Build command `npm install && npm run build`, start
   command `npm --workspace apps/bot run start`.
3. Create a Web Service for the dashboard. Build command
   `npm install && npm run build`, start command
   `npm --workspace apps/dashboard run start`.
4. Set the same environment variables as on Railway. Render injects
   `DATABASE_URL` and `REDIS_URL` as internal connection strings;
   use the external strings only if the bot runs outside Render.
5. Run migrations from the Render shell or from CI before each release:
   `npx prisma migrate deploy --schema prisma/schema.prisma`.

On both platforms, the free tiers sleep or spin down idle services.
A sleeping bot is offline in Discord, so use a paid instance for the
bot worker. That is the one place not to save money.

## 6. Dashboard deployment on Vercel

1. Import the repo into Vercel. Set the framework preset to Next.js.
   The dashboard lives in `apps/dashboard`, but the repo is a workspace:
   Vercel needs the root `package.json` install to link workspaces, so
   leave the Root Directory at the repo root unless your Vercel project
   is already configured for the monorepo layout. If Vercel builds only
   `apps/dashboard`, set its Root Directory to `apps/dashboard` and its
   install command to `npm install --prefix ../..` (workspace aware).
2. Set environment variables in the Vercel project settings:
   `DATABASE_URL`, `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`,
   `NEXTAUTH_URL` (the Vercel domain, for example
   `https://overland-core.vercel.app`), `NODE_ENV=production`, and the
   reserved `NEXTAUTH_SECRET` and `DASHBOARD_SESSION_SECRET` values.
3. Add the matching redirect URI in the Discord application:
   `https://<your-domain>/api/auth/callback`. The dashboard builds its
   OAuth2 URL from `NEXTAUTH_URL`, so a mismatch here breaks sign-in
   with a Discord `redirect_uri` error.
4. Deploy. Dashboard access requires an `InternalTeamMember` row with
   status ACTIVE for the signing-in Discord user; public roles grant no
   dashboard access. The first staff record must be created directly in
   the database (see docs/ARCHITECTURE.md, Internal team).

## 7. Docker

A minimal production layout is three services: bot, Postgres, Redis.
The dashboard can be a fourth service or live on Vercel. Example
`docker-compose.yml` sketch (adapt image tags and volumes to your host):

```yaml
services:
  bot:
    build: .
    command: ["node", "apps/bot/dist/index.js"]
    env_file: .env
    restart: always
    depends_on: [postgres, redis]
  dashboard:
    build: .
    command: ["npm", "--workspace", "apps/dashboard", "run", "start"]
    env_file: .env
    ports: ["3000:3000"]
    restart: always
    depends_on: [postgres]
  postgres:
    image: postgres:16
    environment:
      POSTGRES_USER: overland
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: overland_core
    volumes: ["pgdata:/var/lib/postgresql/data"]
    restart: always
  redis:
    image: redis:7
    volumes: ["redisdata:/data"]
    restart: always
volumes:
  pgdata: {}
  redisdata: {}
```

Rules that apply to any container setup:

- Pass secrets at runtime with `env_file` or the platform secret store.
  Never bake a token into an image layer, and never commit a `.env`
  file that the image copies.
- The image build must run `npm install`, `npm run build` and
  `npx prisma generate`. The Prisma engines are downloaded at build
  time, so the build needs network access to the Prisma binary host.
- Run `npx prisma migrate deploy` as a separate one-off container or
  an entrypoint step before the bot starts, not inside the bot process.
- Keep Postgres data in a named volume or a managed database. A
  container without a volume loses the whole community on recreate.

## 8. Database operations

- Back up PostgreSQL before every migration and on a schedule (daily
  is a reasonable minimum). `pg_dump` for small instances, or the
  managed provider's point-in-time recovery.
- Test restores. A backup you have never restored is a hope, not a
  backup.
- Never store tokens, secrets or passwords in database fields. The
  schema has no credential columns by design; keep it that way.
- Connection limits: the bot and dashboard each hold a small Prisma
  connection pool. On a managed database with a low connection limit,
  set `connection_limit` in `DATABASE_URL` (for example
  `?connection_limit=5`) rather than letting each process open its
  default pool.
- Migrations are additive by default. A migration that drops a column
  or a table needs a reviewed plan and a backup first.

## 9. Logs, monitoring and alerting

- The bot logs structured JSON with pino at `LOG_LEVEL` (default
  `info`). In development it uses pretty printing; in production it
  logs JSON to stdout, which systemd, PM2, Railway and Render all
  collect. Search for `level: 50` (error) and `level: 60` (fatal).
- Watch for these signals:
  - Bot process restarts more than once an hour: usually a config or
    database error, read the log before restarting again.
  - `X poll skipped` every 15 minutes: the X integration is off. That
    is expected without a token; if a token is configured, check the
    `xIntegration` config row.
  - `Duplicate job skipped`: normal duplicate prevention, not an error,
    unless it appears for jobs that should be running.
  - Discord `401` on startup: the bot token is wrong or was reset.
    `403` on a role action: the bot role is below the target role.
- Keep at least one alert on process down (systemd unit inactive, PM2
  process stopped, Railway/Render service crashed) and one on database
  connectivity. The bot cannot alert you itself when it is the thing
  that is down.

## 10. Rollback

- Bot and dashboard: redeploy the previous build artifact or git ref,
  then restart. Nothing in the bot keeps state on disk, so a code
  rollback is just a restart of the old version.
- Database: Prisma migrations have no automatic down step. If a release
  shipped a bad migration, restore the pre-migration backup or write a
  corrective migration that reverses the change. Never edit
  `_prisma_migrations` by hand to pretend a migration did not run.
- Commands: re-running `deploy-commands` from the old ref restores the
  old command set.

## 11. Security notes

- Rotate the Discord bot token and the OAuth2 client secret if either
  is ever exposed. Rotation is in the Discord developer portal; update
  `.env` (or the platform variables) and restart the bot and dashboard.
- The dashboard session cookie is an unsigned base64 JSON blob today
  (see docs/ARCHITECTURE.md, Known limitations). Until session signing
  lands, treat dashboard access as only as strong as the staff check
  behind it, keep the dashboard behind HTTPS, and do not expose it on
  a public URL you do not control.
- Staff actions are gated by `InternalTeamMember` plus
  `PermissionGroup`, never by public Discord roles. Removing a staff
  row or setting its status to INACTIVE revokes dashboard and staff
  command access immediately at next check.
