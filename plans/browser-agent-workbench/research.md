# Reacher Browser Agent Workbench Research Notes

> Parent plan: [plan.md](./plan.md)
> Last verified: 2026-05-27
> Scope: official docs and local architecture synthesis for a Browserbase, Google ADK, Vercel AI SDK, Next.js, Drizzle, SQLite planning milestone

## 1. Method

Inputs used:

- User architecture decisions from this thread.
- Local reference: [../../chatgpt-pro-scaffold.md](../../chatgpt-pro-scaffold.md).
- Official Browserbase docs.
- Official Google ADK docs.
- Official Vercel AI SDK docs.
- Official Drizzle docs.
- Official Next.js docs.
- Dedicated link index: [official-doc-links.md](./official-doc-links.md).

Limitations:

- No Reddit or Twitter/X practitioner research was requested for this planning pass.
- No subagents were requested.
- This is an architecture-planning pass, not an implementation validation pass.
- Browserbase MCP context attachment details should be verified during implementation against the exact SDK/MCP version installed at that time.

## 2. Internal Architecture Findings

### 2.1 Scaffold Is Reference Only

Architecture says:

- The original scaffold recommends a larger CRM-style stack with Postgres, FastAPI/NestJS, LangGraph, Playwright/Stagehand, and Browserbase later.
- The user explicitly replaced those recommendations with Next.js fullstack, SQLite/Drizzle, Python ADK, Gemini, Vercel AI SDK, and Browserbase-first operation.
- Reddit later proved to be an exception because Browserbase login hit network-security/developer-token gating.

Plan import:

- Treat [../../chatgpt-pro-scaffold.md](../../chatgpt-pro-scaffold.md) as prior art only.
- Preserve useful concepts such as lists, evidence, drafts, artifacts, and exports.
- Reject the CRM persona and separate backend assumptions.

### 2.2 Research Means Filter Discovery

Architecture says:

- Research is not only extraction.
- Reacher should find the right filters, queries, platform paths, inclusion rules, and target evidence.

Plan import:

- The data model stores filters, search queries, source paths, candidate sources, scoring reasons, and evidence.
- Exports include the strategy used to find the list, not only the final rows.

### 2.3 Browser Skills Replace Platform Connectors

Architecture says:

- LinkedIn, X, Reddit, and Discord should not be built as API connectors.
- The agent operates the web UI through a logged-in browser.
- Reddit is now the explicit exception where official API-assisted access may be required for research/access.

Plan import:

- Platform-specific behavior lives in editable browser skills/playbooks.
- These skills are loaded by platform, page URL, and task intent.
- Keep LinkedIn, X, and Discord browser-native. Add a separate Reddit API fallback plan.

## 3. Official Tooling Research

### 3.1 Browserbase Browser Agents

Sources:

- [Browserbase browser agents solution](https://www.browserbase.com/solutions/browser-agents)
- [Browserbase agent use cases](https://docs.browserbase.com/use-cases/agents)

Relevant findings:

- Browserbase is positioned for browser agents that navigate websites, interact with authenticated tools, and take web actions on behalf of users.
- Browserbase offers live browser visibility and session recording, which maps well to Reacher's run dashboard and operator supervision.
- Browserbase agent workflows commonly combine browser sessions with higher-level agent frameworks and tools.

Plan import:

- Make Browserbase the default browser substrate.
- Plan for live session links and recording/artifact links in run state.
- Keep browser action logs as first-class run artifacts.

### 3.2 Browserbase Contexts

Sources:

- [Browserbase contexts](https://docs.browserbase.com/platform/browser/core-features/contexts)

Relevant findings:

- Browserbase contexts persist browser state across sessions, including cookies and storage.
- Contexts are the right primitive for logged-in account reuse.

Plan import:

- Use one context per platform: LinkedIn, X, Reddit, Discord.
- Add a context onboarding flow where the user manually logs in and the app marks the context ready only after verification.
- Store provider context IDs in SQLite and keep secrets out of client code.

### 3.3 Browserbase Search and Fetch

Sources:

- [Browserbase agent use cases](https://docs.browserbase.com/use-cases/agents)

Relevant findings:

- Browserbase documents Search/Fetch as lightweight primitives for collecting public page data before running heavier browser sessions.

Plan import:

- Use Search/Fetch for public recon and candidate discovery where possible.
- Escalate to logged-in browser sessions for interactive pages, authenticated pages, and outreach preparation.

### 3.4 Browserbase MCP and Google ADK

Sources:

- [Browserbase Google ADK setup](https://docs.browserbase.com/integrations/google-adk/setup)
- [Google ADK docs](https://adk.dev/)

Relevant findings:

- Browserbase documents an integration path with Google ADK using MCP.
- Google ADK supports agent construction around Gemini and tool use.

Plan import:

- Use a Python ADK runner for long-running tasks.
- Give the runner Browserbase MCP tools for navigation, observation, extraction, and actions.
- During implementation, verify whether MCP startup can bind a specific Browserbase context directly. If not, use Browserbase SDK/session APIs behind the internal browser driver.

### 3.5 Reddit Official API / Developer Access

Sources:

- [Reddit API overview](https://developers.reddit.com/docs/capabilities/server/reddit-api)
- [Reddit Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
- [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms)
- [Reddit Developer Terms](https://redditinc.com/policies/developer-terms)
- [Reddit API documentation](https://www.reddit.com/dev/api/)

Relevant findings:

- Reddit requires OAuth for Data API access.
- Reddit's newer developer platform documentation says Devvit handles authentication for Devvit apps, while external scripts/websites follow a different authentication flow.
- The official Reddit Data API Wiki says some legacy API documentation may be out of date and directs developers to current Developer Terms and Data API Terms.
- Reddit API usage is subject to Reddit's Responsible Builder Policy, Developer Terms, and Data API Terms.

Plan import:

- Add Reddit API-assisted access as an explicit exception to the browser-only platform model.
- Keep Reddit API use focused on research plus Devvit-supported post/comment write actions. Messaging, voting, moderation, and broader account-state changes require a later plan.
- Add a separate Reddit API setup packet before implementation.

### 3.5 Vercel AI SDK

Sources:

- [Vercel AI SDK docs](https://ai-sdk.dev/docs)
- [AI SDK Google Generative AI provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai)

Relevant findings:

- AI SDK supports chat UI patterns, streaming model responses, tool calling, and Google Gemini provider integration.

Plan import:

- Use Vercel AI SDK in Next.js for chat streaming, lightweight intent parsing, structured UI replies, and draft/summarization calls when a full ADK run is not needed.
- Do not force all agentic browser work through AI SDK route handlers.

### 3.6 Drizzle With SQLite

Sources:

- [Drizzle ORM SQLite docs](https://orm.drizzle.team/docs/get-started/sqlite-new)
- [Drizzle migrations docs](https://orm.drizzle.team/docs/migrations)

Relevant findings:

- Drizzle supports SQLite and migration-driven local schemas.
- Drizzle is a strong fit for TypeScript-owned schema in a Next.js local app.

Plan import:

- Drizzle owns schema and migrations.
- SQLite database should use WAL mode in local development to reduce read/write friction between the web app and runner.
- Python runner should write against the migration-defined database contract.

### 3.7 Next.js Fullstack App

Sources:

- [Next.js App Router docs](https://nextjs.org/docs/app)
- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)

Relevant findings:

- Next.js supports app UI, route handlers, server code, and streaming patterns.
- Long-running external browser work should not depend on one request lifecycle.

Plan import:

- Next.js owns the local web app, chat routes, run creation, state reads, and UI.
- A local Python runner owns long-running ADK browser execution.
- Vercel deployability is possible for the web app, but runner deployment needs a separate runtime.

## 4. Adopted Good Hacks

### 4.1 One Context Per Platform

Separate Browserbase contexts isolate login expiry and reduce recovery blast radius. If LinkedIn needs relogin, Reddit and X contexts can remain ready.

### 4.1.1 Platform Network Blocks

During manual setup, Reddit blocked a Browserbase login session with a network-security message. This means platform context readiness must be treated as a runtime health state, not an assumption.

Plan import:

- Context verification must support blocked/error states.
- Reddit research should still support public Search/Fetch paths when authenticated browser login is unavailable.
- Later implementation can evaluate Browserbase geolocation/proxy or verified-browser settings if needed.

### 4.2 Research Strategy as an Artifact

Every useful research run should save the filters and queries that produced the target list. This makes the product better than a scraper because the user can inspect and reuse discovery logic.

### 4.3 Browser Skills as Markdown

Platform skills should start as editable Markdown playbooks rather than compiled code. Browser UI changes will be common, and fast prompt/playbook iteration matters more than early abstraction.

### 4.4 Driver Abstraction Without Playwright Dependency

Keep an internal browser driver interface even though Browserbase is the only v1 implementation. This prevents product logic from depending directly on one MCP tool shape.

## 5. Rejected or Deferred Ideas

| Idea | Decision | Reason |
|---|---|---|
| Postgres-backed CRM | Rejected | The product is local-first and not a full CRM. SQLite is enough for v1. |
| FastAPI/NestJS backend | Rejected | Next.js owns the fullstack app surface. Python exists only as local ADK runner. |
| Social-media APIs for LinkedIn/X/Discord | Rejected for v1 | The user wants browser operation under logged-in accounts. |
| Reddit API-assisted access | Adopted as exception | Reddit Browserbase login was blocked by network-security/developer-token gating during setup. |
| Playwright-first automation | Deferred | Browserbase-first better matches the requested product. Keep abstraction for later fallback. |
| LangGraph | Rejected for v1 | User chose Google ADK with Gemini. |
| Telegram | Deferred | User narrowed v1 platforms to LinkedIn, X, Reddit, and Discord. |
| Autonomous final send | Deferred | v1 prepares the message and stops before final send. |
| Multi-user SaaS hardening | Deferred | Local-first app first; deployability remains a design consideration. |

## 6. Final Research Conclusions

- Browserbase contexts are the central primitive for Reacher's logged-in browser identity model.
- Browserbase Search/Fetch should be part of research runs before heavier interactive browsing.
- Browserbase MCP plus Google ADK is a reasonable first runner architecture, with direct SDK/session fallback planned if context binding or advanced session control requires it.
- Vercel AI SDK should own the chat and lightweight model UX, while ADK owns long-running browser tasks.
- Drizzle should own the SQLite schema from the TypeScript side, with Python runner database access constrained to the migration-defined contract.
- The first implementation should optimize for local reliability and observability, not CRM breadth or social API coverage, with Reddit API-assisted research as the one platform exception.
