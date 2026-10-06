// Display helpers for the progress panel. Pure, unit-tested in test/format.test.ts.

// 4 → "4/10", 5.5 → "5.5/10", 6.666 → "6.7/10"
export function formatScore(score: number): string {
  return `${Number(score.toFixed(1))}/10`;
}

export type ScoreTone = "low" | "mid" | "high";

// Matches the weak threshold: below 7 is weak, below 4 is very weak.
export function scoreTone(score: number): ScoreTone {
  if (score < 4) return "low";
  if (score < 7) return "mid";
  return "high";
}

export function timeAgo(then: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
