// Full chat round-trip against a running dev server (npm run dev).
// Usage: node test/roundtrip.mjs [host] [rounds]   (default localhost:5173, 3)
import { AgentClient } from "agents/client";

const host = process.argv[2] ?? "localhost:5173";
const rounds = Number(process.argv[3] ?? 3);

function connect(name) {
  const client = new AgentClient({ agent: "ChatAgent", name, host });
  // Track the server's message list so chat requests carry the full history.
  client.messages = [];
  client.addEventListener("message", (event) => {
    try {
      const data = JSON.parse(event.data);
      if (data.type === "cf_agent_chat_messages")
        client.messages = data.messages;
    } catch {}
  });
  return new Promise((resolve, reject) => {
    client.addEventListener("open", () => resolve(client), { once: true });
    client.addEventListener("error", reject, { once: true });
  });
}

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

const userA = `test-${crypto.randomUUID()}`;
const a = await connect(userA);
const difficulties = ["easy", "medium", "hard"];

for (let r = 0; r < rounds; r++) {
  const difficulty = difficulties[r % difficulties.length];
  console.log(`\n── Round ${r + 1} (${difficulty}) ──`);

  const problem = await a.call("getNextProblem", [difficulty]);
  check(
    "getNextProblem returns a problem",
    problem?.difficulty === difficulty,
    problem?.title
  );
  const current = await a.call("getCurrentProblem");
  check("getCurrentProblem matches", current?.id === problem.id);
  await new Promise((res) => setTimeout(res, 300)); // let the message broadcast arrive

  const { reply, deltas, chunkTypes } = await chat(
    a,
    `For ${problem.title}, my first idea is a brute force over all options, then I'd optimise it with the right data structure. What should I think about next?`
  );
  console.log(`      reply: ${reply.slice(0, 160).replace(/\n/g, " ")}...`);
  check("Llama replied with text", reply.trim().length > 0);
  const repeats = findRepeats(deltas, reply);
  check(
    "no repeated consecutive chunks/words",
    repeats.length === 0,
    repeats
      .slice(0, 5)
      .map((r) => JSON.stringify(r))
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

  try {
    const grade = await a.call("submitAndGrade");
    const keys = Object.keys(grade.scores).sort();
    const expected = [...problem.topics].sort();
    check(
      "grade keys == problem topics",
      JSON.stringify(keys) === JSON.stringify(expected),
      JSON.stringify(grade.scores)
    );
    check(
      "scores are integers 0-10",
      Object.values(grade.scores).every(
        (s) => Number.isInteger(s) && s >= 0 && s <= 10
      )
    );
    check(
      "feedback present",
      grade.feedback?.trim().length > 0,
      grade.feedback?.slice(0, 100)
    );
  } catch (e) {
    check("submitAndGrade succeeded", false, String(e));
  }
  check(
    "session closed after grading",
    (await a.call("getCurrentProblem")) === null
  );
}

const rows = await a.call("getScores");
check("scores rows written", rows.length > 0, `${rows.length} rows`);

const b = await connect(`test-${crypto.randomUUID()}`);
check(
  "second user has no problem",
  (await b.call("getCurrentProblem")) === null
);
check("second user has no scores", (await b.call("getScores")).length === 0);

a.close();
b.close();
console.log(
  `\n${failures.length === 0 ? "ALL PASSED" : `${failures.length} FAILED: ${failures.join("; ")}`}`
);
process.exit(failures.length === 0 ? 0 : 1);
