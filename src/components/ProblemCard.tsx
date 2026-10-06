import { Badge, Text } from "@cloudflare/kumo";
import { Streamdown } from "streamdown";
import type { Difficulty, Problem } from "../problems";

const DIFFICULTY_VARIANT: Record<Difficulty, "success" | "warning" | "error"> =
  {
    easy: "success",
    medium: "warning",
    hard: "error"
  };

export function ProblemCard({
  problem,
  collapsed
}: {
  problem: Problem;
  collapsed: boolean;
}) {
  return (
    <div className="rounded-xl border border-kumo-line bg-kumo-base px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <Text size="base" bold>
          {problem.title}
        </Text>
        <Badge variant={DIFFICULTY_VARIANT[problem.difficulty]}>
          {problem.difficulty}
        </Badge>
        {problem.topics.map((t) => (
          <Badge key={t} variant="outline">
            {t}
          </Badge>
        ))}
      </div>
      {!collapsed && (
        <Streamdown
          className="sd-theme mt-2 text-sm text-kumo-default leading-relaxed"
          controls={false}
        >
          {problem.statement}
        </Streamdown>
      )}
    </div>
  );
}
