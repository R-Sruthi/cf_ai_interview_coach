// Tool-calling reliability check for Llama 3.3 on Workers AI.
// Run: npx wrangler dev -c test/wrangler.tool-test.jsonc, then curl localhost:8787
import { createWorkersAI } from "workers-ai-provider";
import { generateText, tool } from "ai";
import { z } from "zod";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const RUNS = 5;

const getNextProblemInput = z.object({
  topic: z.string().optional().describe("DSA topic, e.g. 'graphs'"),
  difficulty: z.enum(["easy", "medium", "hard"])
});
const recordScoreInput = z.object({
  topic: z.string().describe("DSA topic the score applies to"),
  score: z.number().min(0).max(10).describe("Score from 0 to 10")
});

// No execute functions: we only inspect the tool calls the model emits.
const tools = {
  getNextProblem: tool({
    description:
      "Fetch the next interview problem from the problem bank. Call this whenever the candidate wants a new problem.",
    inputSchema: getNextProblemInput
  }),
  recordScore: tool({
    description:
      "Record the candidate's score for a topic after they finish explaining their approach.",
    inputSchema: recordScoreInput
  })
};

const SYSTEM =
  "You are a DSA mock interviewer. Use the provided tools when appropriate. Do not invent problems yourself; use getNextProblem.";

type Expected = "getNextProblem" | "recordScore" | null;

const CASES: { name: string; prompt: string; expected: Expected }[] = [
  {
    name: "next-problem-basic",
    prompt: "Give me a medium problem please.",
    expected: "getNextProblem"
  },
  {
    name: "next-problem-topic",
    prompt: "I want to practice graphs. Give me a hard one.",
    expected: "getNextProblem"
  },
  {
    name: "record-score",
    prompt:
      "We're done with the two-pointers problem. I'd grade my approach a 7 out of 10. Please record that score.",
    expected: "recordScore"
  },
  {
    name: "control-no-tool",
    prompt: "What is the time complexity of binary search?",
    expected: null
  }
];

const schemas = {
  getNextProblem: getNextProblemInput,
  recordScore: recordScoreInput
};

// Llama sometimes prints the call as JSON text instead of a structured call.
const looksLikeTextToolCall = (text: string) =>
  /"name"\s*:\s*"(getNextProblem|recordScore)"|\b(getNextProblem|recordScore)\s*\(/.test(
    text
  );

async function runOnce(env: Env, prompt: string, expected: Expected) {
  const workersai = createWorkersAI({ binding: env.AI });
  try {
    const { toolCalls, text } = await generateText({
      model: workersai(MODEL),
      system: SYSTEM,
      prompt,
      tools
    });
    const call = toolCalls[0];
    const toolName = call?.toolName ?? null;
    const argsValid = call
      ? schemas[call.toolName as keyof typeof schemas].safeParse(call.input)
          .success
      : null;
    const pass =
      expected === null
        ? toolCalls.length === 0
        : toolName === expected && argsValid === true;
    return {
      pass,
      toolName,
      input: call?.input ?? null,
      argsValid,
      textToolCall: !call && looksLikeTextToolCall(text),
      text: text.slice(0, 200)
    };
  } catch (error) {
    return { pass: false, error: String(error) };
  }
}

export default {
  async fetch(_request: Request, env: Env) {
    const results = [];
    let passed = 0;
    let total = 0;
    for (const c of CASES) {
      const runs = await Promise.all(
        Array.from({ length: RUNS }, () => runOnce(env, c.prompt, c.expected))
      );
      const casePassed = runs.filter((r) => r.pass).length;
      passed += casePassed;
      total += runs.length;
      results.push({
        case: c.name,
        expected: c.expected,
        passRate: `${casePassed}/${runs.length}`,
        runs
      });
    }
    return Response.json({
      model: MODEL,
      overall: `${passed}/${total}`,
      overallPct: Math.round((passed / total) * 100),
      results
    });
  }
} satisfies ExportedHandler<Env>;
