import { createWorkersAI } from "workers-ai-provider";
import { callable, routeAgentRequest, type Connection } from "agents";
import { AIChatAgent, type OnChatMessageOptions } from "@cloudflare/ai-chat";
import { convertToModelMessages, streamText, type UIMessage } from "ai";
import { dedupeStreamingBinding } from "./ai-binding";
import { MODEL, type Grade } from "./grading";
import {
  getProblem,
  PROBLEMS,
  type Difficulty,
  type Problem,
  type Topic,
  WEAK_THRESHOLD
} from "./problems";
import { buildSystemPrompt } from "./prompt";
import type { GradingParams } from "./workflow";

export { GradingWorkflow } from "./workflow";

interface SessionRow {
  id: string;
  problem_id: string;
  problem_message_id: string;
  started_at: number;
}

export interface TopicStat {
  topic: Topic;
  avgScore: number;
  attempts: number;
}

export interface CoachState {
  grading: {
    status: "idle" | "grading" | "done" | "error";
    sessionId?: string;
    scores?: Grade["scores"];
    feedback?: string;
    error?: string;
  };
  // All scored topics, weakest first.
  topicStats: TopicStat[];
  // Most recent graded sessions, newest first.
  history: HistoryEntry[];
}

export interface HistoryEntry {
  sessionId: string;
  problemId: string;
  title: string;
  scores: Partial<Record<Topic, number>>;
  gradedAt: number;
}

// Set on nudge messages so the UI can style them.
export type MessageKind = "nudge";

const HISTORY_LIMIT = 10;

function textOf(message: UIMessage): string {
  return message.parts
    .map((p) => (p.type === "text" ? p.text : ""))
    .join("")
    .trim();
}

function assistantMessage(text: string, kind?: MessageKind): UIMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    parts: [{ type: "text", text }],
    ...(kind ? { metadata: { kind } } : {})
  };
}

export class ChatAgent extends AIChatAgent<Env, CoachState> {
  maxPersistedMessages = 100;
  chatRecovery = true;
  initialState: CoachState = {
    grading: { status: "idle" },
    topicStats: [],
    history: []
  };

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
    // Per-topic averages over all scores; a topic is "weak" below WEAK_THRESHOLD.
    this.sql`CREATE TABLE IF NOT EXISTS weak_topics (
      topic TEXT PRIMARY KEY,
      avg_score REAL NOT NULL,
      attempts INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`;
    // One nudge per graded session (UNIQUE keeps Workflow step retries idempotent).
    this.sql`CREATE TABLE IF NOT EXISTS pending_nudges (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL UNIQUE,
      topic TEXT NOT NULL,
      message TEXT NOT NULL,
      due_at INTEGER NOT NULL,
      shown_at INTEGER
    )`;
    this.refreshProgress();
  }

  // Pushes topic stats + recent history to clients through state sync.
  private refreshProgress() {
    this.setState({
      ...this.state,
      topicStats: this.topicStats(),
      history: this.recentHistory()
    });
  }

  private recentHistory(): HistoryEntry[] {
    const rows = this.sql<{
      session_id: string;
      problem_id: string;
      ended_at: number;
      topic: Topic;
      score: number;
    }>`
      SELECT s.id AS session_id, s.problem_id, s.ended_at, sc.topic, sc.score
      FROM sessions s JOIN scores sc ON sc.session_id = s.id
      WHERE s.id IN (
        SELECT session_id FROM scores GROUP BY session_id
        ORDER BY MAX(id) DESC LIMIT ${HISTORY_LIMIT}
      )
      ORDER BY s.ended_at DESC, s.id, sc.id`;
    const bySession = new Map<string, HistoryEntry>();
    for (const r of rows) {
      let entry = bySession.get(r.session_id);
      if (!entry) {
        entry = {
          sessionId: r.session_id,
          problemId: r.problem_id,
          title: getProblem(r.problem_id)?.title ?? r.problem_id,
          scores: {},
          gradedAt: r.ended_at
        };
        bySession.set(r.session_id, entry);
      }
      entry.scores[r.topic] = r.score;
    }
    return [...bySession.values()];
  }

  // Only the server (and the Workflow, via the agent) may change state.
  validateStateChange(_next: CoachState, source: Connection | "server") {
    if (source !== "server") throw new Error("State is read-only for clients");
  }

  // Runs after the SDK has sent its protocol messages to the new connection.
  async onConnect() {
    await this.deliverNudges();
  }

  private openSession(): SessionRow | null {
    const [row] = this.sql<SessionRow>`
      SELECT id, problem_id, problem_message_id, started_at FROM sessions
      WHERE ended_at IS NULL ORDER BY started_at DESC LIMIT 1`;
    return row ?? null;
  }

  private topicStats(): TopicStat[] {
    return this.sql<{ topic: Topic; avg_score: number; attempts: number }>`
      SELECT topic, avg_score, attempts FROM weak_topics
      ORDER BY avg_score ASC, topic ASC`.map((r) => ({
      topic: r.topic,
      avgScore: r.avg_score,
      attempts: r.attempts
    }));
  }

  private weakTopics(): Topic[] {
    return this.topicStats()
      .filter((s) => s.avgScore < WEAK_THRESHOLD)
      .slice(0, 3)
      .map((s) => s.topic);
  }

  @callable()
  getCurrentProblem(): Problem | null {
    const session = this.openSession();
    return session ? (getProblem(session.problem_id) ?? null) : null;
  }

  @callable()
  async getNextProblem(difficulty: Difficulty = "medium"): Promise<Problem> {
    if (this.state.grading.status === "grading") {
      throw new Error("Wait for grading to finish.");
    }
    const now = Date.now();
    // Abandon any ungraded problem.
    this.sql`UPDATE sessions SET ended_at = ${now} WHERE ended_at IS NULL`;

    const attempted = new Set(
      this.sql<{
        problem_id: string;
      }>`SELECT DISTINCT problem_id FROM sessions`.map((r) => r.problem_id)
    );
    const preferFresh = (pool: Problem[]) => {
      const fresh = pool.filter((p) => !attempted.has(p.id));
      return fresh.length > 0 ? fresh : pool;
    };

    // When there is a weak topic, always practise the weakest one; the
    // difficulty is a preference that is dropped if that topic has none.
    const [weakest] = this.weakTopics();
    let candidates: Problem[];
    if (weakest) {
      const onTopic = PROBLEMS.filter((p) => p.topics.includes(weakest));
      const atDifficulty = onTopic.filter((p) => p.difficulty === difficulty);
      candidates = preferFresh(
        atDifficulty.length > 0 ? atDifficulty : onTopic
      );
    } else {
      candidates = preferFresh(
        PROBLEMS.filter((p) => p.difficulty === difficulty)
      );
    }
    const problem = candidates[Math.floor(Math.random() * candidates.length)];

    const focus = weakest ? ` Focus topic: **${weakest}**.` : "";
    const message = assistantMessage(
      `**${problem.title}** (${problem.difficulty})${focus}\n\n${problem.statement}\n\nWalk me through your approach before writing any code.`
    );
    this
      .sql`INSERT INTO sessions (id, problem_id, problem_message_id, started_at)
      VALUES (${crypto.randomUUID()}, ${problem.id}, ${message.id}, ${now})`;
    await this.persistMessages([...this.messages, message]);
    return problem;
  }

  // Starts the GradingWorkflow and returns immediately; the result arrives via
  // state sync (grading.status) and a chat message.
  @callable()
  async submitAndGrade(): Promise<{ instanceId: string }> {
    if (this.state.grading.status === "grading") {
      throw new Error("Already grading.");
    }
    const session = this.openSession();
    const problem = session ? getProblem(session.problem_id) : undefined;
    if (!session || !problem) {
      throw new Error("No active problem. Click “New problem” first.");
    }

    const start = this.messages.findIndex(
      (m) => m.id === session.problem_message_id
    );
    const after = this.messages.slice(start + 1);
    if (!after.some((m) => m.role === "user")) {
      throw new Error("Explain your approach in the chat before submitting.");
    }
    const transcript = after
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map(
        (m) =>
          `${m.role === "user" ? "Candidate" : "Interviewer"}: ${textOf(m)}`
      )
      .join("\n\n");

    this.setState({
      ...this.state,
      grading: { status: "grading", sessionId: session.id }
    });
    const instanceId = await this.runWorkflow<GradingParams>(
      "GRADING_WORKFLOW",
      { sessionId: session.id, problemId: problem.id, transcript }
    );
    return { instanceId };
  }

  // Called by GradingWorkflow's save step (DO RPC, not @callable, so clients
  // can't write scores). Safe to retry: a session is only saved once.
  async saveGrade(sessionId: string, grade: Grade) {
    const [session] = this.sql<{ ended_at: number | null }>`
      SELECT ended_at FROM sessions WHERE id = ${sessionId}`;
    if (!session || session.ended_at !== null) return;

    const now = Date.now();
    this.sql`DELETE FROM scores WHERE session_id = ${sessionId}`;
    for (const [topic, score] of Object.entries(grade.scores)) {
      this.sql`INSERT INTO scores (session_id, topic, score, created_at)
        VALUES (${sessionId}, ${topic}, ${score}, ${now})`;
    }
    this.sql`UPDATE sessions SET ended_at = ${now} WHERE id = ${sessionId}`;

    this.sql`DELETE FROM weak_topics`;
    this.sql`INSERT INTO weak_topics (topic, avg_score, attempts, updated_at)
      SELECT topic, AVG(score), COUNT(*), ${now} FROM scores GROUP BY topic`;
    this.refreshProgress();

    const scoreLine = Object.entries(grade.scores)
      .map(([topic, score]) => `${topic}: ${score}/10`)
      .join(" · ");
    await this.persistMessages([
      ...this.messages,
      assistantMessage(`**Grade:** ${scoreLine}\n\n${grade.feedback}`)
    ]);
  }

  // Called by GradingWorkflow's nudge step after the revision delay.
  async createNudge(sessionId: string) {
    const [weakest] = this.topicStats();
    if (!weakest) return;
    const message = `**Revision reminder:** time to revisit **${weakest.topic}** (average ${weakest.avgScore.toFixed(1)}/10). Click “New problem” to practise it.`;
    this
      .sql`INSERT OR IGNORE INTO pending_nudges (session_id, topic, message, due_at)
      VALUES (${sessionId}, ${weakest.topic}, ${message}, ${Date.now()})`;
    // Deliver now if the user is online; otherwise onConnect picks it up.
    if ([...this.getConnections()].length > 0) await this.deliverNudges();
  }

  private async deliverNudges() {
    const pending = this.sql<{ id: number; message: string }>`
      SELECT id, message FROM pending_nudges
      WHERE shown_at IS NULL ORDER BY id`;
    if (pending.length === 0) return;
    const now = Date.now();
    for (const n of pending) {
      this.sql`UPDATE pending_nudges SET shown_at = ${now} WHERE id = ${n.id}`;
    }
    await this.persistMessages([
      ...this.messages,
      ...pending.map((n) => assistantMessage(n.message, "nudge"))
    ]);
  }

  async onWorkflowError(
    _workflowName: string,
    _instanceId: string,
    error: unknown
  ) {
    // The session stays open, so the user can submit again.
    this.setState({
      ...this.state,
      grading: {
        status: "error",
        sessionId: this.state.grading.sessionId,
        error: String(error)
      }
    });
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
    const result = streamText({
      model: workersai(MODEL, { sessionAffinity: this.sessionAffinity }),
      system: buildSystemPrompt(this.getCurrentProblem(), this.weakTopics()),
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
