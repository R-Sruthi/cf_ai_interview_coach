// Unit tests for the chat system prompt. Run: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSystemPrompt } from "../src/prompt.ts";
import type { Problem } from "../src/problems.ts";

const problem: Problem = {
  id: "number-of-islands",
  title: "Number of Islands",
  difficulty: "medium",
  topics: ["graphs"],
  statement: "Count the islands in a grid."
};

test("includes the current problem, its topics and statement", () => {
  const prompt = buildSystemPrompt(problem, []);
  assert.match(
    prompt,
    /Current problem: Number of Islands \(medium; topics: graphs\)/
  );
  assert.match(prompt, /Count the islands in a grid\./);
  assert.doesNotMatch(prompt, /No problem is active/);
});

test("lists weak topics in order when there are some", () => {
  const prompt = buildSystemPrompt(problem, ["dynamic-programming", "graphs"]);
  assert.match(
    prompt,
    /The candidate is weakest at: dynamic-programming, graphs\. Probe these areas\./
  );
});

test("omits the weak-topics line when there are none", () => {
  assert.doesNotMatch(buildSystemPrompt(problem, []), /weakest at/);
});

test("tells the candidate to start a problem when none is active", () => {
  const prompt = buildSystemPrompt(null, ["heaps"]);
  assert.match(prompt, /No problem is active/);
  assert.doesNotMatch(prompt, /Current problem:/);
  assert.match(prompt, /weakest at: heaps/);
});

test("always keeps the interviewer rules", () => {
  for (const prompt of [
    buildSystemPrompt(null, []),
    buildSystemPrompt(problem, ["graphs"])
  ]) {
    assert.match(prompt, /Never write the full solution/);
    assert.match(prompt, /time and space complexity/);
  }
});
