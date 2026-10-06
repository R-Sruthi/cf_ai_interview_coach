// Full round-trip against a running dev server: chat, grading Workflow,
// weak topics and revision nudges.
//
// Start the server with a short nudge delay (overrides the "2 minutes" var):
//   CLOUDFLARE_INCLUDE_PROCESS_ENV=true NUDGE_DELAY="10 seconds" npx vite dev --port 5287
// Then: node test/roundtrip.mjs localhost:5287 [rounds] [nudgeDelaySeconds]
import { AgentClient } from "agents/client";

const host = process.argv[2] ?? "localhost:5173";
const rounds = Number(process.argv[3] ?? 3);
const nudgeDelayMs = Number(process.argv[4] ?? 10) * 1000;
const NUDGE_MARKER = "Revision reminder";
const WEAK_THRESHOLD = 7;

const sleep = (ms) => new Promise((res) => setTimeout(res, ms));

function connect(name) {
  const client = new AgentClient({ agent: "ChatAgent", name, host });
  // Track the server's message list (so chat requests carry the full history)
  // and the synced agent state.
  client.messages = [];
  client.agentState = undefined;
  client.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "cf_agent_chat_messages")
        client.messages = data.messages;
      if (data.type === "cf_agent_state") client.agentState = data.state;
    } catch {}
  });
  return new Promise((resolve, reject) => {
    client.addEventListener("open", () => resolve(client), { once: true });
    client.addEventListener("error", reject, { once: true });
  });
}

// Resolves once `predicate(client)` holds, re-checking on every incoming
// message (state or chat broadcast) rather than polling.
function waitFor(client, predicate, timeoutMs, label) {
  return new Promise((resolve, reject) => {
    if (predicate(client)) return resolve();
    const timer = setTimeout(() => {
      client.removeEventListener("message", onMessage);
      reject(new Error(`timed out waiting for ${label}`));
    }, timeoutMs);
    const onMessage = () => {
      // Run after connect()'s listener has updated messages/state.
      queueMicrotask(() => {
        if (!predicate(client)) return;
        clearTimeout(timer);
        client.removeEventListener("message", onMessage);
        resolve();
      });
    };
    client.addEventListener("message", onMessage);
  });
}

// Load the persisted chat history over HTTP, as useAgentChat does on page load
// (the WebSocket only pushes history when it changes).
async function loadHistory(client, name) {
  const res = await fetch(
    `http://${host}/agents/chat-agent/${name}/get-messages`
  );
  client.messages = await res.json();
}

const textOf = (m) =>
  m.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
const nudgeMessages = (client) =>
  client.messages.filter(
    (m) => m.role === "assistant" && textOf(m).includes(NUDGE_MARKER)
  );
const weakTopics = (client) =>
  (client.agentState?.topicStats ?? []).filter(
    (s) => s.avgScore < WEAK_THRESHOLD
  );

// Send one chat message and collect the streamed reply.
function chat(client, text) {
  const id = crypto.randomUUID();
  const userMessage = {
    id: crypto.randomUUID(),
    role: "user",
    parts: [{ type: "text", text }]
  };
  return new Promise((resolve, reject) => {
    let reply = "";
    const deltas = [];
    const chunkTypes = new Set();
    const timer = setTimeout(() => reject(new Error("chat timed out")), 90_000);
    const onMessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type !== "cf_agent_use_chat_response" || data.id !== id) return;
      if (data.error) {
        clearTimeout(timer);
        return reject(new Error(data.body || "stream error"));
      }
      if (data.body?.trim()) {
        const chunk = JSON.parse(data.body);
        chunkTypes.add(chunk.type);
        if (chunk.type === "text-delta") {
          reply += chunk.delta;
          deltas.push(chunk.delta);
        }
      }
      if (data.done) {
        clearTimeout(timer);
        client.removeEventListener("message", onMessage);
        resolve({ reply, deltas, chunkTypes: [...chunkTypes] });
      }
    };
    client.addEventListener("message", onMessage);
    client.send(
      JSON.stringify({
        id,
        type: "cf_agent_use_chat_request",
        init: {
          method: "POST",
          body: JSON.stringify({
            messages: [...client.messages, userMessage],
            trigger: "submit-message"
          })
        }
      })
    );
  });
}

// Catches the duplicated-stream regression (see src/ai-binding.ts): the same
// delta sent twice in a row, or a word glued to itself like "ForFor".
function findRepeats(deltas, reply) {
  const repeatedChunks = deltas.filter(
    (d, i) => i > 0 && d.trim().length >= 2 && d === deltas[i - 1]
  );
  const gluedWords = reply.match(/\b([A-Za-z]{2,})\1\b/g) ?? [];
  return [...repeatedChunks, ...gluedWords];
}

const failures = [];
function check(label, ok, detail = "") {
  console.log(
    `${ok ? "PASS" : "FAIL"}  ${label}${detail ? `  (${detail})` : ""}`
  );
  if (!ok) failures.push(label);
}

// Submit, check it returns immediately, then wait for the Workflow's result
// to arrive through state sync. Returns the synced grading state.
async function submitAndAwaitGrade(client, problem) {
  const previous = client.agentState?.grading?.sessionId;
  const t0 = Date.now();
  const { instanceId } = await client.call("submitAndGrade");
  const elapsed = Date.now() - t0;
  check(
    "submitAndGrade returns immediately with an instanceId",
    typeof instanceId === "string" && elapsed < 2000,
    `${elapsed}ms`
  );
  await waitFor(
    client,
    (c) =>
      c.agentState?.grading?.status === "done" &&
      c.agentState.grading.sessionId !== previous,
    120_000,
    "grading done"
  );
  const grading = client.agentState.grading;
  const keys = Object.keys(grading.scores).sort();
  check(
    "grade keys == problem topics",
    JSON.stringify(keys) === JSON.stringify([...problem.topics].sort()),
    JSON.stringify(grading.scores)
  );
  check(
    "scores are integers 0-10",
    Object.values(grading.scores).every(
      (s) => Number.isInteger(s) && s >= 0 && s <= 10
    )
  );
  check(
    "feedback present",
    grading.feedback?.trim().length > 0,
    grading.feedback?.slice(0, 100)
  );
  check(
    "session closed after grading",
    (await client.call("getCurrentProblem")) === null
  );
  const [latest] = client.agentState.history;
  check(
    "progress history leads with this session (live via state)",
    latest?.sessionId === grading.sessionId &&
      latest.title === problem.title &&
      JSON.stringify(latest.scores) === JSON.stringify(grading.scores),
    latest ? `${latest.title} ${JSON.stringify(latest.scores)}` : "empty"
  );
  return grading;
}

// history (synced state) must match the scores table, newest first, max 10.
async function checkHistory(client) {
  const rows = await client.call("getScores");
  const bySession = {};
  for (const r of rows) (bySession[r.session_id] ??= {})[r.topic] = r.score;
  const history = client.agentState.history;
  const expectedLength = Math.min(Object.keys(bySession).length, 10);
  const matches = history.every(
    (h) => JSON.stringify(h.scores) === JSON.stringify(bySession[h.sessionId])
  );
  const newestFirst = history.every(
    (h, i) => i === 0 || history[i - 1].gradedAt >= h.gradedAt
  );
  check(
    "history matches scores, newest first",
    history.length === expectedLength && matches && newestFirst,
    `${history.length} entries`
  );
}

// weak_topics (synced as topicStats) must match the raw scores table.
async function checkTopicStats(client) {
  const rows = await client.call("getScores");
  const byTopic = {};
  for (const r of rows) (byTopic[r.topic] ??= []).push(r.score);
  const stats = client.agentState.topicStats;
  const matches =
    stats.length === Object.keys(byTopic).length &&
    stats.every((s) => {
      const scores = byTopic[s.topic] ?? [];
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      return s.attempts === scores.length && Math.abs(s.avgScore - avg) < 1e-9;
    });
  const sorted = stats.every(
    (s, i) => i === 0 || stats[i - 1].avgScore <= s.avgScore
  );
  check(
    "weak_topics matches scores (avg, attempts) and is weakest-first",
    matches && sorted,
    stats
      .map((s) => `${s.topic}:${s.avgScore.toFixed(1)}/${s.attempts}`)
      .join(" ")
  );
}

// ── User A: several graded rounds while staying connected ────────────

const userA = `test-${crypto.randomUUID()}`;
let a = await connect(userA);
const difficulties = ["easy", "medium", "hard"];

for (let r = 0; r < rounds; r++) {
  const difficulty = difficulties[r % difficulties.length];
  console.log(`\n── User A, round ${r + 1} (${difficulty}) ──`);

  const [weakest] = weakTopics(a);
  const problem = await a.call("getNextProblem", [difficulty]);
  if (weakest) {
    check(
      "next problem targets the weakest topic",
      problem.topics.includes(weakest.topic),
      `${weakest.topic} → ${problem.title} [${problem.topics}]`
    );
  } else {
    check(
      "getNextProblem honours difficulty when nothing is weak",
      problem.difficulty === difficulty,
      problem.title
    );
  }
  check(
    "getCurrentProblem matches",
    (await a.call("getCurrentProblem"))?.id === problem.id
  );
  await sleep(300); // let the problem message broadcast arrive

  const { reply, deltas, chunkTypes } = await chat(
    a,
    `For ${problem.title}, my first idea is a brute force over all options, then I'd optimise it with the right data structure. What should I think about next?`
  );
  console.log(`      reply: ${reply.slice(0, 140).replace(/\n/g, " ")}...`);
  check("Llama replied with text", reply.trim().length > 0);
  const repeats = findRepeats(deltas, reply);
  check(
    "no repeated consecutive chunks/words",
    repeats.length === 0,
    repeats
      .slice(0, 5)
      .map((x) => JSON.stringify(x))
      .join(" ")
  );
  check(
    "no tool calls in the stream",
    !chunkTypes.some((t) => t.startsWith("tool-")),
    chunkTypes.join(",")
  );
  await chat(
    a,
    `Final answer: I'd use the optimal approach for ${problem.topics.join(" and ")}, with linear or n log n time and linear extra space, and I'd handle empty input as an edge case.`
  );

  await submitAndAwaitGrade(a, problem);
  await checkTopicStats(a);
  await checkHistory(a);
}

console.log(`\n── User A: nudges while connected ──`);
await waitFor(
  a,
  (c) => nudgeMessages(c).length >= rounds,
  nudgeDelayMs + 60_000,
  `${rounds} nudges`
).catch(() => {});
const nudgesA = nudgeMessages(a);
check(
  "one nudge per graded session arrives after the delay",
  nudgesA.length === rounds,
  `${nudgesA.length}/${rounds}`
);
check(
  "nudges name a scored topic",
  nudgesA.every((m) =>
    a.agentState.topicStats.some((s) => textOf(m).includes(`**${s.topic}**`))
  ),
  nudgesA.map((m) => textOf(m).slice(0, 70)).join(" | ")
);
check(
  "nudge messages are tagged metadata.kind = nudge",
  nudgesA.length > 0 && nudgesA.every((m) => m.metadata?.kind === "nudge")
);

a.close();
a = await connect(userA);
await sleep(1500); // give onConnect a chance to (wrongly) re-deliver
await loadHistory(a, userA);
check(
  "reconnect does not re-deliver shown nudges",
  nudgeMessages(a).length === nudgesA.length,
  `${nudgeMessages(a).length} after reconnect`
);
a.close();

// ── User C: bad answer, offline during the delay, weak-topic targeting ──

console.log(`\n── User C: bad answer → weak topic → offline nudge ──`);
const userC = `test-${crypto.randomUUID()}`;
let c = await connect(userC);
const bad = await c.call("getNextProblem", ["medium"]);
check(
  "fresh user gets the requested difficulty",
  bad.difficulty === "medium",
  bad.title
);
await sleep(300);
await chat(c, "I don't know. I'd just return 0 for every input.");
const badGrade = await submitAndAwaitGrade(c, bad);
check(
  "bad answer scores below the weak threshold",
  Object.values(badGrade.scores).every((s) => s < WEAK_THRESHOLD),
  JSON.stringify(badGrade.scores)
);
const [weakestC] = weakTopics(c);
check(
  "weakest topic comes from the bad answer's problem",
  weakestC !== undefined && bad.topics.includes(weakestC.topic),
  weakestC?.topic
);
c.close(); // go offline before the nudge is written

await sleep(nudgeDelayMs + 15_000);
c = await connect(userC);
await waitFor(
  c,
  (x) => nudgeMessages(x).length >= 1,
  15_000,
  "offline nudge"
).catch(() => {});
check(
  "nudge written while offline is delivered on next connect",
  nudgeMessages(c).length === 1 &&
    textOf(nudgeMessages(c)[0]).includes(`**${weakestC?.topic}**`),
  nudgeMessages(c)
    .map((m) => textOf(m).slice(0, 80))
    .join(" | ")
);

const next = await c.call("getNextProblem", ["medium"]);
check(
  "next problem includes the seeded weak topic",
  next.topics.includes(weakestC?.topic),
  `${next.title} [${next.topics}]`
);
c.close();

// ── Isolation ─────────────────────────────────────────────────────────

const b = await connect(`test-${crypto.randomUUID()}`);
check(
  "another user has no problem",
  (await b.call("getCurrentProblem")) === null
);
check("another user has no scores", (await b.call("getScores")).length === 0);
await waitFor(b, (x) => x.agentState !== undefined, 5_000, "state").catch(
  () => {}
);
check(
  "another user starts with empty progress",
  b.agentState?.history?.length === 0 && b.agentState?.topicStats?.length === 0
);
b.close();

console.log(
  `\n${failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED: ${failures.join("; ")}`}`
);
process.exit(failures.length === 0 ? 0 : 1);
