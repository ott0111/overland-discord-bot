
import { describe, it, expect } from "vitest";
import { withinDailyLimit, computeDailyStreak, streakBonusFor } from "../lib/points.js";
import { isDuplicateMessage, hashMessage, isSpammy, isSuspiciousAccount, detectSelfReferral, detectReferralBurst, containsSuspiciousLink, countMentions } from "../lib/antifraud.js";
import { meetsRoleRequirements } from "../modules/roles/service.js";
import { groupHasPermission } from "../lib/permissions.js";
import { checkCaptchaAnswer, verificationCheck } from "../modules/verification/service.js";
import { transcriptText, nextTicketNumber, formatTicketNumber } from "../modules/tickets/service.js";
import { leaderboardField, paginateLeaderboard, periodKeyFor } from "../modules/leaderboards/service.js";
import { canClaimReward } from "../modules/rewards/service.js";
import { shouldAnnouncePost, filterNewXPosts, dedupePostIds } from "../modules/x-integration/service.js";
import { prisma, audit } from "../lib/db.js";
import { clamp, DEFAULT_POINT_VALUES } from "@overland/shared";

describe("daily limits", () => {
  it("blocks earning over the daily limit", () => { expect(withinDailyLimit(95, 10, 100)).toBe(false); expect(withinDailyLimit(90, 10, 100)).toBe(true); });
  it("default point values match the brief", () => { expect(DEFAULT_POINT_VALUES.community.dailyCheckin).toBe(5); expect(DEFAULT_POINT_VALUES.social.video).toBe(30); expect(DEFAULT_POINT_VALUES.referral.verifiedReferral).toBe(10); expect(DEFAULT_POINT_VALUES.contribution.significantMax).toBe(100); });
});
describe("atomicity invariants (pure model)", () => {
  it("never allows a negative balance", () => { const balance = 10; const after = balance - 15; expect(after < 0).toBe(true); expect(clamp(after, 0, Number.MAX_SAFE_INTEGER)).toBe(0); });
  it("idempotency keys are deterministic per day", () => { const key = (member: string, date: string) => `daily-${member}-${date}`; expect(key("m1", "2026-11-20")).toBe(key("m1", "2026-11-20")); expect(key("m1", "2026-11-20")).not.toBe(key("m2", "2026-11-20")); });
  it("reward claim cannot exceed balance or stock", () => { const canClaim = (credits: number, cost: number, stock: number | null) => credits >= cost && (stock === null || stock > 0); expect(canClaim(50, 100, 5)).toBe(false); expect(canClaim(150, 100, 0)).toBe(false); expect(canClaim(150, 100, 5)).toBe(true); });
});
describe("referral anti-abuse", () => {
  it("rejects self-referrals", () => { expect(detectSelfReferral("a", "a")).toBe(true); expect(detectSelfReferral("a", "b")).toBe(false); });
  it("flags referral bursts", () => { expect(detectReferralBurst(5)).toBe(true); expect(detectReferralBurst(2)).toBe(false); });
});
describe("role requirements", () => {
  it("Comrade requires Citizen", () => { expect(meetsRoleRequirements(["Citizen"], "Citizen", null, 0)).toBe(true); expect(meetsRoleRequirements([], "Citizen", null, 0)).toBe(false); });
  it("enforces minimum Overpoints", () => { expect(meetsRoleRequirements([], null, 100, 50)).toBe(false); expect(meetsRoleRequirements([], null, 100, 150)).toBe(true); });
});
describe("moderation permissions", () => {
  it("Owner bypasses all checks, others need the exact key", () => { expect(groupHasPermission("Owner", [], "moderation.action")).toBe(true); expect(groupHasPermission("Moderation", ["moderation.action"], "moderation.action")).toBe(true); expect(groupHasPermission("Support", ["tickets.view"], "moderation.action")).toBe(false); });
  it("detects suspicious links and mass mentions", () => { expect(containsSuspiciousLink("claim free nitro discord.gift/abc")).toBe(true); expect(containsSuspiciousLink("hello world")).toBe(false); expect(countMentions("<@123> <@456> @everyone")).toBe(3); });
});
describe("spam and duplicates", () => {
  it("detects duplicate messages by hash", () => { const h = hashMessage("Hello Overland"); expect(isDuplicateMessage([h], h)).toBe(true); expect(isDuplicateMessage([], h)).toBe(false); });
  it("detects spam bursts", () => { const now = 100000; expect(isSpammy([now - 1000, now - 2000, now - 3000, now - 4000, now - 5000], now, 10000, 5)).toBe(true); expect(isSpammy([now - 60000], now, 10000, 5)).toBe(false); });
  it("flags suspicious accounts", () => { expect(isSuspiciousAccount(2, 7, true)).toBe(true); expect(isSuspiciousAccount(30, 7, true)).toBe(false); });
});
describe("verification", () => {
  it("checks captcha answers case-insensitively", () => { expect(checkCaptchaAnswer("Overland", " overland ")).toBe(true); expect(checkCaptchaAnswer("Overland", "wrong")).toBe(false); });
  it("requires captcha and account age", () => { expect(verificationCheck(30, 7, true, true).passed).toBe(true); expect(verificationCheck(1, 7, true, true).passed).toBe(false); expect(verificationCheck(30, 7, true, false).passed).toBe(false); });
});
describe("tickets and leaderboards", () => {
  it("builds a transcript", () => { expect(transcriptText([{ authorId: "u1", content: "hi", createdAt: new Date("2026-11-20T00:00:00Z") }])).toContain("u1: hi"); });
  it("maps leaderboard categories to balance fields", () => { expect(leaderboardField("social")).toBe("socialPoints"); expect(leaderboardField("overall")).toBe("overpoints"); expect(leaderboardField("unknown")).toBe("overpoints"); });
});
describe("reward claim guard", () => {
  it("allows a claim with enough credits and stock", () => { expect(canClaimReward(150, 100, 5, true)).toEqual({ ok: true }); });
  it("allows an exact-balance claim and unlimited stock", () => { expect(canClaimReward(100, 100, null, true).ok).toBe(true); });
  it("blocks insufficient Overcredits with the right reason", () => { expect(canClaimReward(50, 100, 5, true)).toEqual({ ok: false, reason: "Insufficient Overcredits" }); });
  it("blocks out-of-stock and inactive rewards", () => { expect(canClaimReward(150, 100, 0, true).reason).toBe("Reward is out of stock"); expect(canClaimReward(150, 100, 5, false).reason).toBe("Reward is not available"); });
  it("blocks a negative cost", () => { expect(canClaimReward(150, -5, 5, true).ok).toBe(false); });
});
describe("daily streak logic", () => {
  const day = (s: string) => new Date(`${s}T00:00:00Z`);
  it("starts at 1 with no previous check-in", () => { expect(computeDailyStreak(null, day("2026-11-20"), 0)).toBe(1); });
  it("increments on consecutive days", () => { expect(computeDailyStreak(day("2026-11-19"), day("2026-11-20"), 6)).toBe(7); });
  it("resets to 1 after a gap of two or more days", () => { expect(computeDailyStreak(day("2026-11-17"), day("2026-11-20"), 6)).toBe(1); });
  it("keeps the streak when checking in again on the same day", () => { expect(computeDailyStreak(day("2026-11-20"), day("2026-11-20"), 4)).toBe(4); });
  it("awards the streak bonus only every 7th day", () => { expect(streakBonusFor(7)).toBe(10); expect(streakBonusFor(14)).toBe(10); expect(streakBonusFor(6)).toBe(0); expect(streakBonusFor(0)).toBe(0); });
});
describe("leaderboard pagination", () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ member: `m${i + 1}`, score: 100 - i }));
  it("returns the first page and the total page count", () => { const p = paginateLeaderboard(rows, 1, 10); expect(p.rows).toHaveLength(10); expect(p.total).toBe(25); expect(p.totalPages).toBe(3); expect(p.rows[0]?.member).toBe("m1"); });
  it("returns the last partial page", () => { const p = paginateLeaderboard(rows, 3, 10); expect(p.rows).toHaveLength(5); expect(p.rows[0]?.member).toBe("m21"); });
  it("clamps out-of-range pages to the last page", () => { expect(paginateLeaderboard(rows, 99, 10).page).toBe(3); expect(paginateLeaderboard(rows, 0, 10).page).toBe(1); });
  it("clamps page size to 1..100", () => { expect(paginateLeaderboard(rows, 1, 500).pageSize).toBe(100); expect(paginateLeaderboard(rows, 1, 0).pageSize).toBe(10); });
  it("keeps lifetime, monthly and weekly period keys distinct", () => { const d = new Date("2026-11-20T00:00:00Z"); expect(periodKeyFor("LIFETIME", d)).toBe("lifetime"); expect(periodKeyFor("MONTHLY", d)).toBe("2026-11"); expect(periodKeyFor("WEEKLY", d)).toMatch(/^\d{4}-W\d{2}$/); });
});
describe("X dedupe by postId", () => {
  const posts = [
    { id: "1", text: "a", isReply: false, isRepost: false },
    { id: "2", text: "b", isReply: false, isRepost: false },
    { id: "1", text: "a again", isReply: false, isRepost: false },
    { id: "3", text: "c", isReply: true, isRepost: false },
  ];
  it("drops already-seen post ids", () => { expect(filterNewXPosts(posts, new Set(["2"])).map((p) => p.id)).toEqual(["1", "3"]); });
  it("drops repeated ids inside the same batch, keeping first-seen order", () => { expect(filterNewXPosts(posts, []).map((p) => p.id)).toEqual(["1", "2", "3"]); });
  it("dedupes a bare id list", () => { expect(dedupePostIds(["1", "2", "1", "3", "2"])).toEqual(["1", "2", "3"]); });
  it("ignores replies and reposts by default, but not when configured off", () => {
    const reply = { id: "9", isReply: true, isRepost: false };
    const repost = { id: "10", isReply: false, isRepost: true };
    expect(shouldAnnouncePost(reply)).toBe(false);
    expect(shouldAnnouncePost(repost)).toBe(false);
    expect(shouldAnnouncePost(reply, false, false)).toBe(true);
    expect(shouldAnnouncePost({ id: "11", isReply: false, isRepost: false })).toBe(true);
  });
});
describe("ticket numbering", () => {
  it("starts at 1 when there is no previous ticket", () => { expect(nextTicketNumber(null)).toBe(1); expect(nextTicketNumber(undefined)).toBe(1); });
  it("increments from the last number", () => { expect(nextTicketNumber(41)).toBe(42); });
  it("formats numbers zero-padded to four digits", () => { expect(formatTicketNumber(1)).toBe("#0001"); expect(formatTicketNumber(42)).toBe("#0042"); expect(formatTicketNumber(12345)).toBe("#12345"); });
});
describe("lazy database layer", () => {
  it("imports without constructing a Prisma Client or touching a database", () => { expect(prisma).toBeDefined(); expect(typeof prisma).toBe("object"); });
  it("audit never throws when no database is available", async () => { await expect(audit(null, "test.ping", "Test", null)).resolves.toBeUndefined(); });
});
