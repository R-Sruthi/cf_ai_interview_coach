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
