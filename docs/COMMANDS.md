# Overland Core - Commands

All commands are guild slash commands for the Overland Finance server,
registered with:

```sh
npm --workspace apps/bot run deploy-commands
```

Registration is guild-scoped to `DISCORD_GUILD_ID`, so commands appear
within seconds. Re-run the command after any change to
`apps/bot/src/commands/index.ts`. Running `/help` in Discord lists the
same commands with their short descriptions.

Permission column meanings:

- Everyone: any server member can run it.
- Staff + key: the caller must have an ACTIVE `InternalTeamMember`
  record whose permission group grants the named key. The Owner group
  bypasses all checks. Public Discord roles grant nothing here.
- Owner only is not a separate column: the Owner group is the only
  group seeded with every permission key, so staff commands are
  effectively limited to the groups an admin assigns the key to.

## Member commands

| Command | Arguments | Permission | What it does |
| --- | --- | --- | --- |
| `/profile` | `member` (optional user) | Everyone | Full member profile: avatar, join date, roles, Overpoints and Overcredits balances, community, social, referral and contribution points, overall leaderboard rank, successful referrals, approved submissions, current daily streak, achievements. Viewing another member shows only public information. |
| `/daily` | none | Everyone | Daily check-in. Awards 5 Overpoints, tracks the consecutive-day streak, and awards a 10 Overcredit bonus every 7th day. One check-in per calendar day; a second attempt the same day is refused. Missing a day resets the streak to 1. |
| `/leaderboard` | `category` (required: overall, community, social, referrals, contributions), `period` (Lifetime, Monthly, Weekly), `page` (number, default 1) | Everyone | Ranked list, 10 per page. Lifetime reads live balances; monthly and weekly read snapshots, so a period reset never erases lifetime statistics. |
| `/invite` | none | Everyone | Your personal referral invite link for the server. New members who join through it and verify earn you referral points. |
| `/referrals` | none | Everyone | Your referral stats: total joins, verified referrals, referrals retained 7 days, referrals who became Comrade. |
| `/campaigns` | none | Everyone | Lists active campaigns with their point reward and end date. |
| `/campaign-info` | `campaign` (required campaign ID) | Everyone | Full details of one campaign: description, objectives, reward, end date, submission requirements. |
| `/submit` | `campaign` (required), `content` (required), `link` (optional) | Everyone | Submit work to an active campaign. Content is required (4000 characters max), links must be valid URLs. A second submission while one is pending returns the existing pending submission instead of creating a duplicate. Staff review it; approval awards the campaign points. |
| `/rewards` | none | Everyone | Browse the rewards marketplace: name, Overcredits cost, stock where limited. |
| `/claim` | `reward` (required reward ID) | Everyone | Claim a reward with Overcredits. The debit, stock decrement and claim record happen in one transaction, and an existing pending claim for the same reward is returned instead of spending twice. A claim starts as PENDING for staff review. |
| `/verify` | none | Everyone | Starts account-age and anti-raid checks, then issues a short-lived CAPTCHA challenge when enabled. |
| `/verify-answer` | `challenge_id`, `answer` | Everyone | Completes the current member's verification challenge and grants Citizen. |
| `/ticket` | `category` (required: General Inquiry, Partnerships, Business Development, Opportunities, Technical Support, Other), `topic` (required) | Everyone | Opens a ticket: a numbered record plus a private channel visible only to you, staff and the bot. One open ticket per member at a time. |
| `/help` | none | Everyone | Lists every command with its short description. |

## Staff commands

| Command | Arguments | Permission | What it does |
| --- | --- | --- | --- |
| `/campaign-review` | `submission` (required), `approve` (required true/false), `feedback` (optional) | Staff, `campaigns.review` | Review a pending submission. Approval awards the campaign points atomically with the status change; rejection records feedback and awards nothing. An already reviewed submission cannot be reviewed again. |
| `/reward-claim` | `claim` (required), `action` (required: approve, reject, fulfill) | Staff, `rewards.review` | Manage a reward claim. Rejecting refunds the Overcredits atomically and restores stock. Fulfilling requires an approved claim. |
| `/verify-user` | `member` (required user) | Staff, `roles.assign` | Staff verification of a member: grants Citizen. Use for members the automatic check cannot clear. |
| `/grant-role` | `member` (required), `role` (required role name), `reason` (optional) | Staff, `roles.assign` | Grant a community role. Internal roles (Founder, Admin, Warden) are refused on this path; they are assigned through internal team management only. Prerequisite roles are enforced (Comrade requires Citizen). |
| `/warn` | `member` (required), `reason` (required) | Staff, `moderation.action` | Record a warning against a member. Written to moderation history and the audit log. |
| `/timeout` | `member` (required), `minutes` (required, 1 to 40320), `reason` (required) | Staff, `moderation.action` | Timeout a member for the given minutes and record the action. |
| `/ticket-claim` | `ticket` (required ticket ID) | Staff, `tickets.manage` | Claim a ticket so one staff member owns the response. |
| `/ticket-close` | `ticket` (optional ticket ID; omit when run inside the ticket channel) | Ticket owner or staff, `tickets.manage` | Close a ticket, build its transcript, store it in the audit log, and delete the private channel. |
| `/x-announce` | `url` (required X post URL) | Staff, `x.manage` | Manually announce one X post. The post id is parsed from the URL, deduped against announced posts, and the live timeline text is used when the API can fetch it. |
| `/kick` | `member`, `reason` | Staff, `moderation.action` | Kick a member and record the action. |
| `/ban` | `member`, `reason` | Staff, `moderation.action` | Ban a member and record the action. |
| `/unban` | `user_id`, `reason` | Staff, `moderation.action` | Unban a user by Discord ID. |
| `/purge` | `amount` (2-100) | Staff, `moderation.action` | Bulk-delete recent messages in the current text channel. Discord excludes messages older than 14 days. |
| `/mod-history` | `member` | Staff, `moderation.view` | View the latest recorded moderation actions for a member. |
| `/security status` | none | Staff, `moderation.view` | Inspect lockdown, spam, mention and invite-filter settings. |
| `/security configure` | optional thresholds and filters | Staff, `moderation.action` | Configure spam threshold, detection window, mention limit, invite filter and suspicious-link action. |
| `/security lockdown` | `action` (enable/disable) | Staff, `moderation.action` | Lock down text channels and restore their previous @everyone send permissions when disabled. |
| `/ticket-setup` | `staff_role`, `category` (optional) | Staff, `config.manage` | Configure the staff role and category for private tickets. |
| `/verification-setup` | minimum age, CAPTCHA, avatar, anti-raid window and threshold (optional) | Staff, `config.manage` | Configure verification and anti-raid requirements. |
| `/x-setup` | username, channel, enabled, poll interval, filters | Staff, `x.manage` | Configure X timeline announcements. Requires `X_BEARER_TOKEN`. |

## Info commands

These seven commands serve content from the `infoContent` row in
`BotConfiguration`, editable in the dashboard. `/socials` is separate: it
reads saved links from the `socialLinks` configuration row.

| Command | Content |
| --- | --- |
| `/about` | About Overland Finance |
| `/links` | Official Overland links |
| `/team` | Meet the Overland team |
| `/roadmap` | Overland roadmap |
| `/updates` | Latest Overland updates |
| `/faq` | Frequently asked questions |
| `/opportunities` | Open opportunities |
| `/socials` | Saved social links, rendered as an embed with URL buttons |

## Configuration commands

| Command | Permission | What it does |
| --- | --- | --- |
| `/setup` | Everyone | Shows guided setup instructions for a selected feature. |
| `/link add` | Staff, `config.manage` | Add a named HTTPS link. The key defaults to a normalized version of the label. |
| `/link edit` | Staff, `config.manage` | Update the label and URL for an existing link key. |
| `/link remove` | Staff, `config.manage` | Remove a saved link. |
| `/link list` | Everyone | List configured links and keys. |
| `/welcome setup` | Staff, `config.manage` | Set the welcome channel, title, message and enabled state. Supports `{user}` and `{server}` placeholders. |
| `/welcome preview` | Everyone | Preview the current welcome embed privately. |

Saved links live in the `socialLinks` BotConfiguration row. `/socials` reads this configuration at runtime and builds link buttons automatically. Welcome, ticket, verification, X and moderation settings are persisted in `BotConfiguration`; routine changes do not require a code deploy.

## X integration

The X integration has no member-facing command. It works like this:

- The bot polls the official Overland X timeline (X API v2) at the configured interval (15 minutes by default), starting once at startup.
- Replies and reposts are ignored by default. This is configurable in
  the `xIntegration` configuration row.
- New posts are deduped by post id in the `x_posts` table (unique
  constraint) and by the pure `filterNewXPosts` helper, then announced
  in the configured channel as a branded embed with the post text, a
  link to the post, and the first image where present.
- Every announced post is recorded with its channel and time, so the
  dashboard can show the full post history.
- Staff can announce a single post early with `/x-announce` (see the
  staff table above).

Without `X_BEARER_TOKEN`, or with the integration disabled in
configuration, polling is skipped and the bot logs why. The integration
never scrapes X and never invents posts: if the API returns nothing,
nothing is announced.

## Point values

The values below are the seeded defaults from `packages/shared` and the
`pointValues` configuration row. Admins can change them in the
dashboard; the live configuration always wins over this document.

Community (Overpoints):

| Action | Points |
| --- | --- |
| Daily check-in | 5 |
| Meaningful daily participation | 2 |
| Helpful answer | 5 |
| Community event participation | 15 |
| Weekly challenge completion | 20 |
| Approved community contribution | 20 |
| Streak bonus, every 7th day | 10 Overcredits |

Social (Overpoints):

| Action | Points |
| --- | --- |
| Approved original Overland X post | 15 |
| Approved infographic | 25 |
| Original educational thread | 30 |
| Approved community article | 30 |
| Campaign contribution | 20 |
| Approved video | 30 |

Referral (Overpoints):

| Action | Points |
| --- | --- |
| Verified referral | 10 |
| Referral remains active for 7 days | 10 bonus |
| Referral becomes Comrade | 5 bonus |

Contribution (Overpoints):

| Action | Points |
| --- | --- |
| Approved graphic or design | 25 |
| Useful industry research | 30 |
| Approved article | 30 |
| Accepted product feedback | 15 |
| Successful community initiative | 40 |
| Significant contribution | 50 to 100 (staff judged) |

Daily earning is capped at 100 Overpoints per member per day by
default. Awards are idempotent: repeating the same action with the
same reference (message id, event id, submission id) pays once.

## Behaviour notes

- All embeds use the Overland brand: emerald #00C982, lime #C5E86C,
  dark backgrounds, white and muted grey type. The bot never publishes
  the em dash character in account content.
- Error replies are generic ("Something went wrong. Staff have been
  notified."). Details go to the log and the audit log, never to the
  member.
- Commands that need the database fail with that generic message when
  the database is unavailable, rather than crashing the bot.
- `/daily` and `/leaderboard` read the live database; `/help` and the
  info commands work from configuration and need no per-member data.
