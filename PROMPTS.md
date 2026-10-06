# Prompts

## 1. Scaffold project

```
npm create cloudflare@latest -- cf_ai_interview_coach --template cloudflare/agents-starter
cd cf_ai_interview_coach
npx wrangler login
git init && git add . && git commit -m "starter"
```

## 2. Add Cloudflare docs MCP

```
claude mcp add --transport http cloudflare-docs https://docs.mcp.cloudflare.com/mcp this si for you give Claude live Cloudflare docs so it doesn't hallucinate old APIs
```

## 3. Create CLAUDE.md

```
Create CLAUDE.md in the repo root

This is the context Claude reads every session:

md
# Project: cf_ai_interview_coach
DSA mock interview coach on Cloudflare.

## Stack
- Agents SDK (AIChatAgent = Durable Object, 1 per user, built-in SQLite via this.sql)
- Workers AI: @cf/meta/llama-3.3-70b-instruct-fp8-fast
- Workflows for grading + spaced-repetition scheduling
- React chat UI (from agents-starter)

## Rules
- Check Cloudflare docs MCP before using any CF API
- Explain the plan before writing code
- After each task, append my prompt verbatim to PROMPTS.md
- Don't touch unrelated starter files
```

## 4. Project context + CLAUDE.md

```
Context: I'm building a take-home assignment for Cloudflare (fast-track hiring). Requirements:
- LLM: Llama 3.3 on Workers AI (@cf/meta/llama-3.3-70b-instruct-fp8-fast)
- Workflow/coordination: Cloudflare Workflows + Durable Objects
- User input via chat (React UI on Pages/Workers), voice optional
- Memory/state
- Repo name must start with cf_ai_, needs README.md (run instructions + deployed link) and PROMPTS.md (all AI prompts I used)

What I'm building: "DSA Mock Interview Coach"
- User chats with an AI interviewer that gives a DSA problem, hints, and grades their approach
- One Durable Object (Agents SDK AIChatAgent) per user, with SQLite tables: sessions, scores, weak_topics
- Weak topics are injected into the system prompt so the interviewer targets them
- A Cloudflare Workflow runs: grade answer → update weak_topics → sleep N days → revision nudge
- Tools: getNextProblem, recordScore, scheduleRevision

Base: Cloudflare agents-starter template (npm create cloudflare@latest -- --template cloudflare/agents-starter)

Do this now:
1. Check whether this folder already has the starter. If not, tell me the command to run, and don't scaffold it yourself.
2. Create CLAUDE.md with this context plus these rules: explain the plan before coding, verify CF APIs against current docs, log every prompt I give verbatim to PROMPTS.md, and don't touch unrelated files.
3. Create PROMPTS.md and log this prompt.
4. Then stop and summarize what you understood.
```

## 5. Decisions + plan step 1

```
Decisions on your open questions:
1. Nudge: agreed. The Workflow writes a pending nudge into the user's DO, shown on next visit.
2. Problem bank: hard-coded 20–30 problems, each tagged with topics + difficulty.
3. Grading: LLM gives live hints/feedback in chat; the Workflow's grade step produces structured JSON {topic: score} that updates weak_topics.
4. Llama tool calling: test it first. If unreliable, make getNextProblem/recordScore deterministic code paths instead of LLM tools.

Add these decisions to CLAUDE.md. Confirm the cloudflare-docs MCP is loaded.
Then plan step 1 only: switch to Llama 3.3 via the Workers AI binding, remove OpenAI deps, update wrangler config, and write a tiny tool-calling test. Show the plan, don't code yet. Log this prompt to PROMPTS.md.
```

## 6. Approve step 1

```
Approved. Two tweaks:
1. Make sure test/ doesn't break npm run check (separate tsconfig or exclude it).
2. After verification passes, commit with message "step 1: llama 3.3 + tool-call test".
Then report the tool-call pass rates and stop. Log this prompt to PROMPTS.md.
```

## 7. Plan step 2: deterministic tools

```
Results are clear: no false tool calls is the hard requirement, so apply decision #4.
Plan step 2 (don't code yet):
- Remove LLM tools from the chat agent (including the starter demo tools). Llama only gives hints and feedback, with the current problem + weak topics injected into the system prompt.
- getNextProblem and recordScore become agent methods called from UI buttons ("New problem", "Submit & grade"). Check the docs MCP for the right Agents SDK way to call agent methods from the client (e.g. @callable).
- Add the SQLite schema (sessions, scores, weak_topics, pending_nudges) and a hard-coded problem bank of about 25 problems tagged with topic and difficulty.
- No Workflow yet; recordScore just writes the score for now.
- Also do the full chat round-trip test you skipped in step 1.
Record the tool-call findings in CLAUDE.md under Decisions (they'll go in the README later). Log this prompt to PROMPTS.md.
```

## 8. Grading call: structured output

```
Two additions for the grading call:
1. Use structured output (generateObject or Workers AI JSON mode, check docs MCP for Llama 3.3 support) instead of parsing free text.
2. Restrict the score keys to the current problem's topics (zod enum built from problem.topics), so Llama can't invent topic names that pollute weak_topics.
```

## 9. No commits

```
dont commit anything, just local changes
```

## 10. Fix duplicated stream + commit step 2

```
Yes: go with A and tighten the grading feedback prompt.
Also:
- Add a check to test/roundtrip.mjs that fails if the streamed reply has repeated consecutive words/chunks (e.g. "ForFor"), so this regression is caught automatically.
- Put a comment on the binding wrapper explaining the provider bug and when it can be removed.
- Rerun npm run check and the round-trip test on a fresh dev server.
- If everything passes, commit as "step 2: deterministic problem/score flow + schema + grading" (don't leave it uncommitted).
Log this prompt to PROMPTS.md.
```

## 11. Progress section in CLAUDE.md

```
Update CLAUDE.md with a "Progress" section: steps 1–2 done (commits eec4064, c4d3e8e), what each added, the ai-binding.ts wrapper, and that step 3 (Workflow) is next. Log this prompt to PROMPTS.md.
```

## 12. Plan step 3: grading Workflow

```
Read CLAUDE.md first for full context.

Step 3: add the Cloudflare Workflow. Plan only, don't code yet. Check the docs MCP for current Workflows APIs and whether the Agents SDK has a built-in agent↔workflow integration.

Flow:
- submitAndGrade no longer grades inline. It starts a GradingWorkflow with { userId, sessionId, problemId, transcript } and returns immediately.
- Workflow steps:
  1. grade: the same structured-output grading function as now (retries on failure)
  2. save: call back into the user's ChatAgent DO to write scores, close the session, and recompute weak_topics (avg_score, attempts)
  3. sleep: configurable via env var (e.g. 2 minutes in dev for the demo, days in prod)
  4. nudge: write a pending_nudges row for the weakest topic
- The UI should update when grading finishes without polling. Use agent state sync (setState → client) if that's the right pattern.
- Pending nudges show in chat on the next connect and are marked shown_at.
- Weak topics feed into getNextProblem selection and the system prompt (verify this works end to end now that weak_topics gets filled).

Extend test/roundtrip.mjs to cover: submit → workflow completes → weak_topics updated → nudge appears after the sleep (use a short sleep in test).
Log this prompt to PROMPTS.md.
```

## 13. Approve step 3

```
Plan approved. Decisions:
1. Delete local .wrangler/state, no migration.
2. Deployed NUDGE_DELAY = "2 minutes" for the demo; README notes prod would use days.
3. No test-only callables. Instead: export buildSystemPrompt(problem, weakTopics) as a pure function and unit test it, and make getNextProblem always pick from the weakest topic when weak topics exist (random only among those). Then the test seeds a low score through the real flow (submit a deliberately bad answer) and checks the next problem's topics include that topic.
Keep userId out of params as you proposed.
When npm run check and the round-trip pass on a fresh server, update the Progress section in CLAUDE.md and commit as "step 3: grading workflow + weak topics + nudges".
Log this prompt to PROMPTS.md.
```

## 14. Plan step 4: progress panel + UI polish

```
Read CLAUDE.md first for full context.

Step 4: UI polish so the memory is visible in the demo. Plan briefly, then wait for my approval.

1. Right-side "Progress" panel (collapses to a drawer on mobile):
   - Weak topics: each topic with avg score as "x/10", attempts count, and a small bar. Sorted weakest first.
   - Score history: last ~10 graded sessions (problem title, topics + scores, time ago).
   - Updates live through agent state sync after each grade, with no refresh.
2. Top bar: show weak-topic chips as "graphs · 0/10" instead of "0.0".
3. Empty state for a new user: a short welcome card explaining the flow (New problem → explain approach → Submit & grade → coach remembers weak topics and nudges you to revise).
4. Problem card: show title, difficulty badge, topic tags, and statement clearly while a problem is active.
5. Style nudge messages differently from normal replies (a small "Revision reminder" label).

Don't change server logic beyond what the panel needs (e.g. a @callable getProgress() returning weak topics + recent history, read-only).
Run npm run check and the round-trip test, then commit as "step 4: progress panel + UI polish".
Log this prompt to PROMPTS.md.
```

## 15. Approve step 4

```
Approved. Put history in state as you proposed, no getProgress() callable.
Commit once npm run check, npm test and the round-trip pass. I'll check the layout in the browser after and report any issues as a follow-up.
Log this prompt to PROMPTS.md.
```
