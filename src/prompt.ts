import type { Problem, Topic } from "./problems";

// Pure so it can be unit tested (test/prompt.test.ts).
export function buildSystemPrompt(
  problem: Problem | null,
  weakTopics: Topic[]
): string {
  const problemContext = problem
    ? `Current problem: ${problem.title} (${problem.difficulty}; topics: ${problem.topics.join(", ")})\n${problem.statement}`
    : "No problem is active. If the candidate wants to practice, tell them to click “New problem”.";
  const weakContext =
    weakTopics.length > 0
      ? `The candidate is weakest at: ${weakTopics.join(", ")}. Probe these areas.`
      : "";

  return `You are a technical interviewer running a DSA mock interview.
- Never write the full solution or full code. Give one small hint at a time, only when the candidate is stuck or asks.
- Ask about time and space complexity and edge cases.
- Be concise and encouraging. When the candidate is done, tell them to click “Submit & grade”.

${problemContext}
${weakContext}`.trim();
}
