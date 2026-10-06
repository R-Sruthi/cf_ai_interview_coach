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
