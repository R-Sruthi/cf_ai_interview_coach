import { createWorkersAI } from "workers-ai-provider";
import { generateText, Output } from "ai";
import { z } from "zod";
import type { Problem, Topic } from "./problems";

export const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

export interface Grade {
  scores: Partial<Record<Topic, number>>;
  feedback: string;
}

// Score keys are built from the problem's own topics, so the model can't
// invent topic names that would end up in weak_topics.
function gradeSchema(topics: Problem["topics"]) {
  const topicEnum = z.enum(topics);
  const score = z.number().int().min(0).max(10);
  return z.object({
    feedback: z
      .string()
      .describe(
        "2-3 sentences addressed to the candidate: what they got right, what was missing or wrong, and the optimal time/space complexity. No numbers or scores."
      ),
    scores: z
      .object(
        Object.fromEntries(topicEnum.options.map((t) => [t, score])) as Record<
          Topic,
          typeof score
        >
      )
      .strict()
  });
}

// Structured output via Workers AI JSON mode. Throws if the model can't
// satisfy the schema, which the Workflow's grade step turns into a retry.
export async function gradeTranscript(
  ai: Ai,
  problem: Problem,
  transcript: string
): Promise<Grade> {
  const workersai = createWorkersAI({ binding: ai });
  const { output } = await generateText({
    model: workersai(MODEL),
    output: Output.object({ schema: gradeSchema(problem.topics) }),
    system: `You grade DSA mock interviews. Score the candidate 0-10 on each listed topic, based only on what the candidate said.
10 = optimal approach with correct complexity, clearly explained. 7 = correct but suboptimal or with gaps. 4 = partially correct. 0-2 = wrong or no real attempt.
Hints the interviewer gave lower the score.
The feedback field is written to the candidate ("you"). It must explain the reasoning behind the scores, never restate them, and never be a preamble like "Here are the scores".`,
    prompt: `Problem: ${problem.title}\n${problem.statement}\n\nTopics to score: ${problem.topics.join(", ")}\n\nTranscript:\n${transcript}`
  });
  return { scores: output.scores, feedback: output.feedback };
}
