// Unit tests for progress-panel formatting. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatScore, scoreTone, timeAgo } from "../src/format.ts";

test("formatScore drops a trailing .0 and rounds to one decimal", () => {
  assert.equal(formatScore(0), "0/10");
  assert.equal(formatScore(4), "4/10");
  assert.equal(formatScore(5.5), "5.5/10");
  assert.equal(formatScore(6.666), "6.7/10");
  assert.equal(formatScore(10), "10/10");
});

test("scoreTone splits at 4 and the weak threshold (7)", () => {
  assert.equal(scoreTone(0), "low");
  assert.equal(scoreTone(3.9), "low");
  assert.equal(scoreTone(4), "mid");
  assert.equal(scoreTone(6.9), "mid");
  assert.equal(scoreTone(7), "high");
  assert.equal(scoreTone(10), "high");
});

test("timeAgo buckets seconds, minutes, hours and days", () => {
  const now = 1_000_000_000_000;
  assert.equal(timeAgo(now, now), "just now");
  assert.equal(timeAgo(now - 59_000, now), "just now");
  assert.equal(timeAgo(now - 60_000, now), "1m ago");
  assert.equal(timeAgo(now - 59 * 60_000, now), "59m ago");
  assert.equal(timeAgo(now - 60 * 60_000, now), "1h ago");
  assert.equal(timeAgo(now - 25 * 3_600_000, now), "1d ago");
});

test("timeAgo treats future timestamps (clock skew) as just now", () => {
  assert.equal(timeAgo(2_000, 1_000), "just now");
});
