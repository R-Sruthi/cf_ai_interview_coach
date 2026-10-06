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
