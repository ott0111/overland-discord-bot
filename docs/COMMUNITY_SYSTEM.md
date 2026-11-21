# Overland Finance Community System

This document describes the Discord roles, internal permissions, points, campaigns, referrals, rewards and community automation.

## First-time setup

1. Configure PostgreSQL in \`.env\` using \`DATABASE_URL\`.
2. Set \`DISCORD_TOKEN\`, \`DISCORD_CLIENT_ID\` and \`DISCORD_GUILD_ID\`.
3. Set \`OVERLAND_OWNER_DISCORD_ID\` to the Discord user ID of the Founder. Optionally set \`OVERLAND_OWNER_USERNAME\`.
4. Run \`npx prisma migrate deploy --schema prisma/schema.prisma\`.
5. Run \`npx prisma generate --schema prisma/schema.prisma\`.
6. Run \`npm run db:seed\`. The seed creates the permission groups, role definitions, point defaults and the first Founder/Owner staff record.
7. Invite the bot with the \`bot\` and \`applications.commands\` scopes. Enable Server Members, Message Content and Guild Invites intents as required by the configured features.
8. Put the bot's highest role above every Overland-managed community role it must assign or remove.
9. Configure Discord role IDs and self-assignable roles in the dashboard.
10. Use \`/verification-panel\` to publish onboarding and \`/setup\` to edit public information pages.

Never commit real environment values. The Founder bootstrap uses a Discord ID, not a Discord role, to create the first Owner permission record.

## Public Discord roles

- **Citizen**: granted after successful verification.
- **Comrade**: requires Citizen and verified follow status for the official Overland X account. Use \`/comrade-verify\` for authorized staff verification. The bot does not pretend X's public timeline API proves a user follows an account.
- **Socialite**: earned from configured community reputation thresholds.
- **Creator**: earned from approved creative submissions, such as graphic design, infographics, videos, articles and original social posts.
- **Intellect**: earned from approved research and educational submissions.
- **Pioneer**: reserved for early members and manually awarded by staff.
- **Luminary**: staff-awarded recognition for influential community members.

Founder, Admin and Warden are internal positions. Internal Discord roles are not permission grants. The bot's permission checks use the private Internal Team record and permission-group assignments, never a public role name.

### Role controls

- Configure Discord role mappings, prerequisites, progression thresholds and self-assignable interest roles in the dashboard.
- Members use \`/interests\` and \`/interest\` to manage interest roles.
- Staff use \`/grant-role\` for Pioneer or Luminary recognition, \`/comrade-verify\` for X follow verification, and \`/role-history\` to inspect role changes.
- Removing a prerequisite removes held dependent roles. For example, removing Citizen also removes Comrade.
- Discord changes to bot-managed public roles are reconciled against the database role ledger and recorded in role history. Internal roles are excluded and remain manually assigned.

## Internal team and permissions

Private staff records are managed in the dashboard. Each record stores Discord ID, username, public role label, internal job title, department, responsibilities, permission group, status and date added.

Permission groups:
- Owner
- Executive
- Administration
- Moderation
- Development
- Support
- Rewards Management

The Owner group has full control. Other groups receive conservative starter permissions and can be configured independently in the dashboard. The same permission key may be granted to multiple groups. Removing a staff member marks the record REMOVED instead of deleting its history.

## Overpoints and Overcredits

- **Overpoints** are lifetime reputation. They cannot be spent by members.
- **Overcredits** are redeemable reward currency.

Every award, debit, refund and administrative adjustment is written to the point transaction ledger. PostgreSQL conditional updates, transactions, idempotency keys and non-negative balance constraints prevent double awards and negative balances. Reward claims reserve stock and debit Overcredits in one transaction. A member can have only one active claim for the same reward at a time.

Daily limits are configurable in the dashboard. Positive earning paths use a per-member PostgreSQL advisory lock so concurrent awards cannot race past the configured daily cap.

### Default earning values

| Category | Action | Default |
|---|---|---:|
| Community | Daily check-in | 5 |
| Community | Meaningful participation | 2 |
| Community | Helpful answer | 5 |
| Community | Event attendance | 15 |
| Community | Weekly challenge | 20 |
| Community | Approved community contribution | 20 |
| Social | Original Overland X post | 15 |
| Social | Infographic | 25 |
| Social | Educational thread | 30 |
| Social | Article | 30 |
| Social | Campaign contribution | 20 |
| Social | Video | 30 |
| Referrals | Verified referral | 10 |
| Referrals | Seven-day retention bonus | 10 |
| Referrals | Comrade conversion bonus | 5 |
| Contributions | Graphic/design | 25 |
| Contributions | Industry research | 30 |
| Contributions | Article | 30 |
| Contributions | Product feedback | 15 |
| Contributions | Community initiative | 40 |
| Contributions | Significant contribution | 50–100 |

Values and daily caps are configurable. The command labels do not hard-code point amounts.

## Campaigns and submissions

Staff create and manage campaigns in the dashboard. Members use:
- \`/campaigns\` to list active campaigns.
- \`/campaign-info\` to read objectives, dates, tasks, reward and requirements.
- \`/submit\` to submit text, a link and optional supporting image URL.
- \`/campaign-gallery\` to view approved work.

Staff use \`/campaign-review\` to approve or reject submissions and leave feedback. Approvals award the configured points once, and the submission category determines the reputation category and role progression eligibility.

## Referrals

\`/invite\` creates or reuses a persistent member-specific Discord invite. \`/referrals\` shows referral progress. A referral is not rewarded until the referred member completes Citizen verification. Seven-day retention and Comrade conversion bonuses are separate, idempotent awards.

Discord invite attribution has platform limitations:
- The bot needs permission to fetch server invites.
- Vanity URL joins cannot be attributed to a member-specific invite.
- Joins that happen while the bot is offline may not be attributable.
- Concurrent joins can make invite-use deltas ambiguous.
- The system does not fingerprint devices or claim certainty about alternate accounts; it uses account-age, verification and burst signals for risk review.

## Rewards marketplace

Members use \`/rewards\` and the claim buttons to browse and request rewards. Claims are pending until staff review. Staff use \`/reward-claim\` to approve, reject (with refund) or fulfill. Reward stock and balance changes are atomic.

## Leaderboards and achievements

\`/leaderboard\` supports overall, community, social, referrals and contributions with lifetime, monthly and weekly periods. Monthly and weekly snapshots are calculated from transactions in the period; lifetime balances are never reset. Snapshots refresh hourly.

\`/daily\` handles daily check-ins and streaks. Achievements are configured in the dashboard and displayed on \`/profile\`. Community polls, spotlights and staff-recorded attendance are available through \`/poll\`, \`/spotlight\`, \`/spotlight-set\` and \`/event-award\`.

## X integration

Set \`X_BEARER_TOKEN\` and configure the official account and announcement channel with \`/x-setup\`. The bot polls the official X API v2 timeline, ignores replies and reposts according to settings, stores post history and avoids duplicate announcements. Image URLs and video preview images are included where X supplies them. The original X post remains linked for video playback.

X follower status is not inferred from timeline access. Comrade follow status must be verified by an authorized integration or staff.

## Public information pages

Use \`/setup\` with one of About, Links, Team, Roadmap, Updates, FAQ, Opportunities or Socials. Add the \`content\` option to replace the page text. Only internal staff with \`config.manage\` can edit pages. Public \`/team\` displays the configured public text and never exposes private staff records.
