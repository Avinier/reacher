# Architecture Decisions

> Parent plan: [plan.md](./plan.md)
> Scope: source-of-truth decisions for Reacher v1 planning

## 1. Product Frame

Reacher is a browser-native agent workbench.

It is not:

- A full CRM.
- A YC-specific researcher.
- A social API integration suite. Reddit API-assisted access is a narrow fallback, not the product pattern.
- A mass-message backend.

The v1 product should feel like a local command center where the user can ask an agent to research a topic, discover useful filters, browse with authenticated accounts, produce ranked outreach lists, generate drafts, export the work, and prepare manual-send outreach flows.

## 2. Architecture Decisions

| ID | Decision | Rationale |
|---|---|---|
| ADR-001 | Use Next.js as the fullstack app surface. | Keeps the local web app simple and deployable. No separate backend service is needed for v1. |
| ADR-002 | Use SQLite with Drizzle. | Local-first storage fits the product and avoids Postgres operational overhead. |
| ADR-003 | Use Python Google ADK runner with Gemini. | Browserbase documents an ADK path and Python is acceptable for local runner work. |
| ADR-004 | Use Vercel AI SDK in Next.js. | Best fit for chat UX, streaming, structured generation, and lightweight model calls in the app. |
| ADR-005 | Use Browserbase as the primary browser substrate. | The product is centered on a logged-in browser agent; Browserbase contexts and live sessions match this. |
| ADR-006 | Use one Browserbase context per platform. | Isolates account login state, expiry, recovery, and verification. |
| ADR-007 | Use Browserbase Search/Fetch before interactive browsing. | Public recon should be faster and cheaper than opening full sessions for every page. |
| ADR-008 | Model platforms as browser skills, not connectors by default. | LinkedIn, X, and Discord are operated through web UI. Reddit may need official API-assisted access because Browserbase login can be network-blocked or developer-token-gated. |
| ADR-009 | Stop before final send in v1. | The user accepted final manual send; this is reliable and keeps operator control. |
| ADR-010 | Store research filters as first-class data. | The research value is discovering the right filters and target logic, not just scraping rows. |

## 3. Runtime Boundary

Next.js owns:

- Local UI.
- Chat route.
- Run creation and status display.
- SQLite reads and most writes.
- Drizzle schema and migrations.
- Browser context onboarding UI.
- Export download UI.

Python ADK runner owns:

- Long-running research and outreach preparation jobs.
- Gemini agent workflow.
- Browserbase MCP calls.
- Platform browser skill loading.
- Step logs and artifact writes.
- Export generation when it needs runner-side context.

Browserbase owns:

- Browser session execution.
- Persistent browser contexts.
- Live view.
- Recordings and session diagnostics where available.
- Search/Fetch public recon where configured.

Reddit API-assisted fallback owns:

- Reddit OAuth/client configuration if browser login remains blocked.
- Read-focused subreddit, post, comment, and public user research where official access is required.
- No v1 Reddit messaging, posting, commenting, voting, moderation, or account-state changes without a separate accepted plan.

## 4. Deployment Decision

V1 is local-first. The web app should remain deployable to Vercel in principle, but the full system requires a runner runtime.

Deployment modes:

| Mode | Description | Status |
|---|---|---|
| Local full system | Next.js app, SQLite file, Python runner, Browserbase cloud sessions. | Primary v1 target. |
| Vercel web + local runner | Web app deployed, runner still local with tunnel or separate sync. | Later experiment. |
| Vercel web + hosted runner | Web app deployed, runner hosted as separate worker service. | Deferred. |

The plan should not add a separate backend service for v1 just to make deployment simpler.

## 5. Data Ownership Decision

Drizzle is the schema source of truth. Python runner code must not invent separate schema migrations.

Acceptable runner database access:

- Direct SQLite writes using tables defined by Drizzle migrations.
- Small repository layer in Python with explicit SQL statements.
- Shared JSON schemas for payload columns.

Rejected runner database access:

- A second ORM that owns migrations.
- Python-generated schema changes.
- Hidden tables not represented in the planning docs.

## 6. Browser Driver Decision

Browserbase is the only v1 browser driver, but product code should speak to an internal driver contract.

Minimum driver capabilities:

```text
create_session(context_key, run_id) -> session
close_session(session_id, persist_context)
search(query, options) -> results
fetch(url, options) -> page_snapshot
navigate(session_id, url)
observe(session_id, instruction)
act(session_id, instruction)
extract(session_id, schema, instruction)
snapshot(session_id) -> artifact
```

This contract allows direct Browserbase MCP use first and direct SDK/session APIs later if needed.

## 7. Outreach Decision

V1 outreach preparation flow:

```text
saved target
  -> select platform context
  -> open profile/page
  -> open message or reply composer
  -> paste or stage draft
  -> stop before final send
  -> operator sends manually or marks outcome
  -> app stores outcome
```

The data model should be able to represent later explicit-send automation, but the v1 UI should not offer final-send clicking.

## 8. Rejected Architecture From Reference Scaffold

| Reference recommendation | V1 decision |
|---|---|
| Postgres CRM | SQLite local workbench |
| FastAPI/NestJS backend | Next.js fullstack plus local Python runner |
| LangGraph | Google ADK |
| Playwright/Stagehand as default | Browserbase MCP/browser agents first |
| Browserbase later | Browserbase first |
| CRM dashboard persona | Research and outreach workbench |
| Policy-heavy approval system | Operator instruction and manual final send in v1 |
| No social APIs at all | Browser-native by default, Reddit API-assisted fallback allowed |

## 9. Open Implementation Checks

These are not architecture blockers, but implementation must verify them:

- Exact Browserbase MCP mechanism for starting sessions against a named context.
- Whether hosted MCP exposes all needed session/context options or local MCP configuration is required.
- Best way for Next.js to launch and supervise the Python runner locally on macOS.
- SQLite file locking behavior under simultaneous Next.js and Python runner writes.
- Browserbase live-view and recording URL availability through the chosen tool path.
