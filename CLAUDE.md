# Project: cf_ai_interview_coach

DSA Mock Interview Coach: a take-home assignment for Cloudflare (fast-track hiring).

## Product

- User chats with an AI interviewer that gives a DSA problem, offers hints, and grades their approach
- Weak topics are injected into the system prompt so the interviewer targets them
- Tools: `getNextProblem`, `recordScore`, `scheduleRevision`

## Stack

- LLM: Llama 3.3 on Workers AI (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`)
- Agents SDK `AIChatAgent` = one Durable Object per user, built-in SQLite via `this.sql`
  - Tables: `sessions`, `scores`, `weak_topics`
- Cloudflare Workflow: grade answer → update weak_topics → sleep N days → revision nudge
- React chat UI from the agents-starter template (served on Workers); voice is optional

## Decisions

- Revision nudge: the Workflow writes a pending nudge into the user's DO; it's shown on their next visit
- Problem bank: hard-coded 20–30 problems, each tagged with topics + difficulty
- Grading: the LLM gives live hints/feedback in chat; the Workflow's grade step produces structured JSON `{topic: score}` that updates `weak_topics`
- Llama tool calling: test it first. If unreliable, make `getNextProblem`/`recordScore` deterministic code paths instead of LLM tools
- Tool-calling findings (step 1, `test/tool-call.worker.ts`, AI SDK + `workers-ai-provider`, 5 runs per prompt): 15/20 overall (75%)
  - Correct tool + schema-valid args on every prompt that needed a tool (15/15); no tool calls printed as plain text
  - Called a tool on 5/5 runs of a plain conceptual question ("time complexity of binary search?" → `getNextProblem`)
  - Requirement is zero false tool calls, so decision #4 applies: the chat agent has no LLM tools; `getNextProblem`/`recordScore` are `@callable()` agent methods triggered by UI buttons

## Progress

- [x] Step 1: Llama 3.3 + tool-call test (`eec4064`)
  - Switched the chat model to Llama 3.3 via the `AI` binding + `workers-ai-provider` (starter had no OpenAI deps to remove)
  - Renamed the worker/package to `cf-ai-interview-coach` (worker names can't contain `_`)
  - `test/tool-call.worker.ts` + `test/wrangler.tool-test.jsonc`: tool-calling reliability test (results under Decisions)
  - `test/` is excluded from the root `tsconfig.json` and has its own `test/tsconfig.json`
- [x] Step 2: deterministic problem/score flow + schema + grading (`c4d3e8e`)
  - `src/problems.ts`: 25 hard-coded problems across 13 topics, each with difficulty + topics
  - `ChatAgent` (`src/server.ts`): no LLM tools, no MCP/demo code; system prompt built from the current problem + weak topics
  - SQLite tables created in `onStart()`: `sessions`, `scores`, `weak_topics`, `pending_nudges` (the last two are filled in step 3)
  - `@callable()` methods: `getNextProblem`, `getCurrentProblem`, `submitAndGrade`, `getScores`; `recordScore` is private, so scores only come from the grader
  - Grading: `generateText` + `Output.object` (Workers AI JSON mode); score keys are built from `z.enum(problem.topics)` so Llama can't invent topics
  - UI (`src/app.tsx`): per-user Durable Object (random id in `localStorage` passed as `useAgent({ name })`), difficulty picker, "New problem" and "Submit & grade" buttons; MCP, tool UI and image attachments removed
  - `test/roundtrip.mjs`: full chat round-trip against a running dev server (`node test/roundtrip.mjs localhost:<port> [rounds]`)
  - `src/ai-binding.ts`: `dedupeStreamingBinding()` works around a `workers-ai-provider` bug (3.3.1 and 4.0.0). Llama 3.3 stream chunks carry each token in both `response` and `choices[0].delta.content`, and the provider emits both, so every token appeared twice. The wrapper drops `response` from streamed chunks that also have `choices`. Only the chat stream uses it. Remove it once the provider reads one field; the round-trip test's "no repeated consecutive chunks/words" check guards against the regression
- [x] Step 3: grading workflow + weak topics + nudges
  - Uses the Agents SDK integration: `GradingWorkflow extends AgentWorkflow<ChatAgent, GradingParams>` (`src/workflow.ts`), started with `this.runWorkflow("GRADING_WORKFLOW", { sessionId, problemId, transcript })`; `this.agent` routes back to the user's DO, so there's no `userId` param
  - Steps: `grade` (`gradeTranscript` in `src/grading.ts`; 3 retries, exponential backoff) → `save` (`this.agent.saveGrade`) → `step.mergeAgentState({ grading: done })` → `step.sleep(env.NUDGE_DELAY)` → `nudge` (`this.agent.createNudge`)
  - `submitAndGrade` returns `{ instanceId }` immediately; the UI gets the result through agent state sync (`CoachState.grading`, `topicStats`), with no polling. `validateStateChange` rejects client state writes
  - `saveGrade`/`createNudge` are public for DO RPC but not `@callable`, so browsers can't call them. Both are safe to retry: a session is saved once; `pending_nudges.session_id` is UNIQUE + `INSERT OR IGNORE`
  - `weak_topics` holds per-topic `AVG(score)`/`COUNT(*)` over all scores, recomputed on every save; "weak" means avg < `WEAK_THRESHOLD` (7, in `src/problems.ts`)
  - `getNextProblem` always picks from the weakest topic when one exists (the difficulty is only a preference); the system prompt lists up to 3 weak topics
  - `buildSystemPrompt` (`src/prompt.ts`) is a pure function, unit-tested in `test/prompt.test.ts` (`npm test`)
  - Nudges: written for the user's weakest topic after the delay; delivered immediately if the user is connected, otherwise in `onConnect`; `shown_at` prevents re-delivery
  - `NUDGE_DELAY` is `"2 minutes"` in `wrangler.jsonc` (deployed demo; real use would be days). The round-trip test overrides it: `CLOUDFLARE_INCLUDE_PROCESS_ENV=true NUDGE_DELAY="10 seconds" npx vite dev --port <port>`, then `node test/roundtrip.mjs localhost:<port> 3 10`
  - `pending_nudges` gained a `session_id` column; the local `.wrangler/state` was deleted rather than migrated (nothing deployed yet)
- [x] Step 4: progress panel + UI polish
  - `CoachState.history`: the last 10 graded sessions (`{ sessionId, problemId, title, scores, gradedAt }`, newest first), recalculated with `topicStats` in `refreshProgress()` (called from `saveGrade` and `onStart`). The panel updates live through state sync; there is no `getProgress()` callable
  - Nudge messages carry `metadata: { kind: "nudge" }` (`MessageKind`); the UI falls back to the `**Revision reminder:**` text prefix for older messages
  - `src/components/`: `ProgressPanel` (topics weakest first with "x/10", attempts and a colour bar; recent sessions with per-topic score badges and "time ago"), `ProblemCard` (title, difficulty badge, topics, markdown statement; collapses while grading), `WelcomeCard` (4-step flow for new users)
  - Layout: the panel is a right column at `lg`+, and a slide-over drawer opened by the header "Progress" button below `lg`. The top bar shows weak-topic chips as "graphs · 4/10"
  - `src/format.ts` (`formatScore`, `scoreTone`, `timeAgo`), unit-tested in `test/format.test.ts`
  - Layout not yet checked in a browser (no browser automation here); the user is reviewing it
- [ ] Next: README (run instructions, deployed link, note that prod `NUDGE_DELAY` would be days), deploy

## Assignment requirements

- LLM, workflow/coordination, chat input, and memory/state must all be present
- Repo name must start with `cf_ai_`
- README.md: run instructions + deployed link
- PROMPTS.md: every AI prompt used

## Rules

- Explain the plan before writing code
- Verify Cloudflare APIs against current docs (Cloudflare docs MCP) before using them
- Log every prompt the user gives, verbatim, to PROMPTS.md
- Don't touch unrelated files (including starter files not needed for the task)

## Environment

- Requires Node >= 22 (use nvm's v24: `source ~/.nvm/nvm.sh && nvm use 24`)
