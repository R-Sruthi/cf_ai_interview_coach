import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import {
  convertToModelMessages,
  generateText,
  Output,
  streamText,
  type UIMessage
} from "ai";
import { z } from "zod";
import { dedupeStreamingBinding } from "./ai-binding";
import {
  getProblem,
  PROBLEMS,
  type Difficulty,
  type Problem,
  type Topic
} from "./problems";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

interface SessionRow {
  id: string;
  problem_id: string;
  problem_message_id: string;
  started_at: number;
}

export interface GradeResult {
  problemId: string;
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

function textOf(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

function assistantMessage(text: string): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{ type: "text", text }]
  };
}

export class ChatAgent extends AIChatAgent<Env> {
  maxPersistedMessages = 100;
  chatRecovery = true;

  onStart() {
    this.sql`CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      problem_id TEXT NOT NULL,
      problem_message_id TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      ended_at INTEGER
    )`;
    this.sql`CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      topic TEXT NOT NULL,
      score INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    )`;
    // Filled by the grading Workflow (step 3).
    this.sql`CREATE TABLE IF NOT EXISTS weak_topics (
      topic TEXT PRIMARY KEY,
      avg_score REAL NOT NULL,
      attempts INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`;
    // Written by the Workflow, shown on the user's next visit (step 3).
    this.sql`CREATE TABLE IF NOT EXISTS pending_nudges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      topic TEXT NOT NULL,
      message TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      shown_at INTEGER
    )`;
  }

  private openSession(): SessionRow | null {
    const [row] = this.sql<SessionRow>`
      SELECT id, problem_id, problem_message_id, started_at FROM sessions
      WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`;
    return row ?? null;
  }

  private weakTopics(): Topic[] {
    return this.sql<{ topic: Topic }>`
      SELECT topic FROM weak_topics ORDER BY avg_score ASC LIMIT 3`.map(
      (r) => r.topic
    );
  }

  @callable()
  getCurrentProblem(): Problem | null {
    const session = this.openSession();
    return session ? (getProblem(session.problem_id) ?? null) : null;
  }

  @callable()
  async getNextProblem(difficulty: Difficulty = "medium"): Promise<Problem> {
    const now = Date.now();
    // Abandon any ungraded problem.
    this.sql`UPDATE sessions SET ended_at = ${now} WHERE ended_at IS NULL`;

    const attempted = new Set(
      this.sql<{
        problem_id: string;
      }>`SELECT DISTINCT problem_id FROM sessions`.map((r) => r.problem_id)
    );
    const ofDifficulty = PROBLEMS.filter((p) => p.difficulty === difficulty);
    const fresh = ofDifficulty.filter((p) => !attempted.has(p.id));
    const pool = fresh.length > 0 ? fresh : ofDifficulty;
    const weak = new Set(this.weakTopics());
    const targeted = pool.filter((p) => p.topics.some((t) => weak.has(t)));
    const candidates = targeted.length > 0 ? targeted : pool;
    const problem = candidates[Math.floor(Math.random() * candidates.length)];

    const message = assistantMessage(
      `**${problem.title}** (${problem.difficulty})\n\n${problem.statement}\n\nWalk me through your approach before writing any code.`
    );
    this
      .sql`INSERT INTO sessions (id, problem_id, problem_message_id, started_at)
      VALUES (${crypto.randomUUID()}, ${problem.id}, ${message.id}, ${now})`;
    await this.persistMessages([...this.messages, message]);
    return problem;
  }

  @callable()
  async submitAndGrade(): Promise<GradeResult> {
    const session = this.openSession();
    const problem = session ? getProblem(session.problem_id) : undefined;
    if (!session || !problem) {
      throw new Error("No active problem. Click “New problem” first.");
    }

    const start = this.messages.findIndex(
      (m) => m.id === session.problem_message_id
    );
    const transcript = this.messages
      .slice(start + 1)
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(
        (m) =>
          `${m.role === "user" ? "Candidate" : "Interviewer"}: ${textOf(m)}`
      )
      .join("\n\n");
    if (!this.messages.slice(start + 1).some((m) => m.role === "user")) {
      throw new Error("Explain your approach in the chat before submitting.");
    }

    const workersai = createWorkersAI({ binding: this.env.AI });
    const { output } = await generateText({
      model: workersai(MODEL),
      output: Output.object({ schema: gradeSchema(problem.topics) }),
      system: `You grade DSA mock interviews. Score the candidate 0-10 on each listed topic, based only on what the candidate said.
10 = optimal approach with correct complexity, clearly explained. 7 = correct but suboptimal or with gaps. 4 = partially correct. 0-2 = wrong or no real attempt.
Hints the interviewer gave lower the score.
The feedback field is written to the candidate ("you"). It must explain the reasoning behind the scores, never restate them, and never be a preamble like "Here are the scores".`,
      prompt: `Problem: ${problem.title}\n${problem.statement}\n\nTopics to score: ${problem.topics.join(", ")}\n\nTranscript:\n${transcript}`
    });

    this.recordScore(session.id, output.scores);
    const result: GradeResult = {
      problemId: problem.id,
      scores: output.scores,
      feedback: output.feedback
    };
    const scoreLine = Object.entries(output.scores)
      .map(([topic, score]) => `${topic}: ${score}/10`)
      .join(" · ");
    await this.persistMessages([
      ...this.messages,
      assistantMessage(`**Grade:** ${scoreLine}\n\n${output.feedback}`)
    ]);
    return result;
  }

  // Not callable: scores only come from the grader, never straight from the client.
  private recordScore(
    sessionId: string,
    scores: Partial<Record<Topic, number>>
  ) {
    const now = Date.now();
    for (const [topic, score] of Object.entries(scores)) {
      this.sql`INSERT INTO scores (session_id, topic, score, created_at)
        VALUES (${sessionId}, ${topic}, ${score}, ${now})`;
    }
    this.sql`UPDATE sessions SET ended_at = ${now} WHERE id = ${sessionId}`;
  }

  @callable()
  getScores() {
    return this.sql<{ session_id: string; topic: string; score: number }>`
      SELECT session_id, topic, score FROM scores ORDER BY id`;
  }

  async onChatMessage(_onFinish: unknown, options?: OnChatMessageOptions) {
    const workersai = createWorkersAI({
      binding: dedupeStreamingBinding(this.env.AI)
    });
    const problem = this.getCurrentProblem();
    const weak = this.weakTopics();

    const problemContext = problem
      ? `Current problem: ${problem.title} (${problem.difficulty}; topics: ${problem.topics.join(", ")})\n${problem.statement}`
      : "No problem is active. If the candidate wants to practice, tell them to click “New problem”.";
    const weakContext =
      weak.length > 0
        ? `The candidate is weakest at: ${weak.join(", ")}. Probe these areas.`
        : "";

    const result = streamText({
      model: workersai(MODEL, { sessionAffinity: this.sessionAffinity }),
      system: `You are a technical interviewer running a DSA mock interview.
- Never write the full solution or full code. Give one small hint at a time, only when the candidate is stuck or asks.
- Ask about time and space complexity and edge cases.
- Be concise and encouraging. When the candidate is done, tell them to click “Submit & grade”.

${problemContext}
${weakContext}`,
      messages: await convertToModelMessages(this.messages),
      abortSignal: options?.abortSignal
    });

    return result.toUIMessageStreamResponse();
  }
}

export default {
  async fetch(request: Request, env: Env) {
    return (
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
