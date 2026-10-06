import { useEffect, useState } from "react";
import { Badge, Text } from "@cloudflare/kumo";
import { ChartBarIcon, ClockCounterClockwiseIcon } from "@phosphor-icons/react";
import type { HistoryEntry, TopicStat } from "../server";
import { formatScore, scoreTone, timeAgo, type ScoreTone } from "../format";

const BAR_COLOR: Record<ScoreTone, string> = {
  low: "bg-kumo-danger",
  mid: "bg-kumo-warning",
  high: "bg-kumo-success"
};

const BADGE_VARIANT: Record<ScoreTone, "error" | "warning" | "success"> = {
  low: "error",
  mid: "warning",
  high: "success"
};

// Re-render periodically so "3m ago" labels stay current.
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function SectionTitle({
  icon,
  children
}: {
  icon: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center gap-2 mb-3 text-kumo-subtle">
      {icon}
      <Text size="xs" variant="secondary" bold>
        {children}
      </Text>
    </div>
  );
}

function TopicRow({ stat }: { stat: TopicStat }) {
  const tone = scoreTone(stat.avgScore);
  return (
    <li className="space-y-1">
      <div className="flex items-baseline justify-between gap-2">
        <Text size="sm">{stat.topic}</Text>
        <span className="text-xs text-kumo-subtle tabular-nums whitespace-nowrap">
          {formatScore(stat.avgScore)} · {stat.attempts}{" "}
          {stat.attempts === 1 ? "attempt" : "attempts"}
        </span>
      </div>
      {/* Decorative: the score is already in the text above. */}
      <div
        className="h-1.5 rounded-full bg-kumo-recessed overflow-hidden"
        aria-hidden="true"
      >
        <div
          className={`h-full rounded-full ${BAR_COLOR[tone]}`}
          style={{ width: `${Math.max(2, stat.avgScore * 10)}%` }}
        />
      </div>
    </li>
  );
}

function HistoryRow({ entry, now }: { entry: HistoryEntry; now: number }) {
  return (
    <li className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2">
        <Text size="sm" bold>
          {entry.title}
        </Text>
        <span className="text-xs text-kumo-inactive whitespace-nowrap">
          {timeAgo(entry.gradedAt, now)}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {Object.entries(entry.scores).map(([topic, score]) => (
          <Badge key={topic} variant={BADGE_VARIANT[scoreTone(score)]}>
            {topic} · {formatScore(score)}
          </Badge>
        ))}
      </div>
    </li>
  );
}

export function ProgressPanel({
  topicStats,
  history
}: {
  topicStats: TopicStat[];
  history: HistoryEntry[];
}) {
  const now = useNow();
  return (
    <div className="space-y-6">
      <section>
        <SectionTitle icon={<ChartBarIcon size={14} />}>
          Topics (weakest first)
        </SectionTitle>
        {topicStats.length === 0 ? (
          <Text size="xs" variant="secondary">
            No scores yet. Grade a problem to see your topics here.
          </Text>
        ) : (
          <ul className="space-y-3">
            {topicStats.map((s) => (
              <TopicRow key={s.topic} stat={s} />
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionTitle icon={<ClockCounterClockwiseIcon size={14} />}>
          Recent sessions
        </SectionTitle>
        {history.length === 0 ? (
          <Text size="xs" variant="secondary">
            No graded sessions yet.
          </Text>
        ) : (
          <ul className="space-y-4">
            {history.map((h) => (
              <HistoryRow key={h.sessionId} entry={h} now={now} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
