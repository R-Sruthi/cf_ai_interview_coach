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
