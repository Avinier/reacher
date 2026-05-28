# Reacher - Browser Agent Workbench Plan

> Status: architecture and planning draft
> Last updated: 2026-05-27
> Anchor reference: [chatgpt-pro-scaffold.md](../../chatgpt-pro-scaffold.md)
> Research notes: [research.md](./research.md)

## 1. Purpose

This folder defines the architecture plan for Reacher: a local-first browser-native agent workbench focused first on research, filter discovery, outreach-list preparation, draft generation, Markdown/CSV/JSON exports, and operator-driven outreach preparation.

The product is not a CRM and not a YC-company researcher. It is a general agent with a persistent logged-in browser that can browse, inspect, reason, operate web apps, save structured results, and prepare outreach workflows. The first product workflows are research and outreach across web versions of LinkedIn, X, Reddit, and Discord.

This plan is intentionally architecture-only. It does not scaffold the application.

## 2. Non-Negotiables

| Requirement | Concrete interpretation |
|---|---|
| Browser-native agent | The primary automation surface is Browserbase browser sessions. Reddit may use official API-assisted access when browser login is blocked or developer-token-gated. |
| General and liquid agent | The system must not hard-code each platform as a narrow API connector. Platform behavior lives in browser skills/playbooks that the agent can load while browsing; Reddit API access is an explicit fallback, not the default pattern. |
| Persistent logged-in accounts | Use one Browserbase context per platform: LinkedIn, X, Reddit, Discord. Each context stores the user's logged-in browser state. |
| Final manual send in v1 | The v1 outreach action opens the conversation UI, prepares or pastes the draft, then stops before the final send click. |
| Google ADK with Gemini | Long-running agent execution is owned by a Python Google ADK runner using Gemini. |
| Vercel AI SDK | Next.js chat and lightweight model calls use Vercel AI SDK. |
| Local-first storage | SQLite is the primary local database. Drizzle owns schema and migrations. |
| No separate backend service | Next.js owns the fullstack app surface. A local Python runner is allowed for long-running ADK jobs. |
| Browserbase Search/Fetch allowed | Public recon can use Browserbase Search/Fetch before launching an interactive browser session. |
| Planning first | This folder plans architecture and milestones only. No app code should be created from this milestone. |

## 3. Source Documents

- [../../chatgpt-pro-scaffold.md](../../chatgpt-pro-scaffold.md): reference only; do not treat as source of truth.
- [research.md](./research.md): official tooling notes and adopted decisions.
- [official-doc-links.md](./official-doc-links.md): canonical official docs to use during implementation.
- [environment-and-secrets.md](./environment-and-secrets.md): required local environment variables and secret handling.
- [architecture-decisions.md](./architecture-decisions.md): decision log for the target architecture.
- [browserbase-contexts-plan.md](./browserbase-contexts-plan.md): persistent browser identity plan.
- [agent-runner-plan.md](./agent-runner-plan.md): Python ADK runner design.
- [data-model-plan.md](./data-model-plan.md): SQLite/Drizzle schema plan.
- [web-app-ux-plan.md](./web-app-ux-plan.md): Next.js app surface and workflows.
- [browser-skill-system-plan.md](./browser-skill-system-plan.md): browser skill/playbook model.
- [reddit-api-fallback-plan.md](./reddit-api-fallback-plan.md): Reddit-specific official API fallback when browser login is blocked.
- [exports-and-artifacts-plan.md](./exports-and-artifacts-plan.md): exports, evidence, and artifact model.
- [agent-task-packets.md](./agent-task-packets.md): implementation-ready task packets for later coding work.

## 4. Deliverable Set

| Deliverable | Required output |
|---|---|
| Architecture decision log | Final decisions, rejected alternatives, and deployment caveats. |
| Browser identity plan | One-context-per-platform onboarding, verification, expiry handling, and session reuse. |
| Agent runner plan | Python ADK runner boundaries, Next.js handoff, Browserbase MCP usage, lifecycle, and streaming state. |
| Data model plan | SQLite entities for runs, filters, targets, drafts, actions, browser contexts, and artifacts. |
| UX plan | Local app surfaces for chat, runs, lists, context onboarding, session viewer, exports, and outreach preparation. |
| Skill system plan | Browser skill file structure and loading rules for LinkedIn, X, Reddit, and Discord. |
| Artifact/export plan | Markdown/CSV/JSON exports, evidence capture, and browser session artifacts. |
| Agent task packets | Copy-pasteable implementation prompts with write scopes and acceptance criteria. |

## 5. Target Architecture

```text
apps/web
  Next.js local web app
  Vercel AI SDK chat and streaming UX
  Drizzle schema and migrations
  local API routes/server actions
  run dashboard, list views, exports, browser context onboarding

apps/runner
  Python Google ADK runner
  Gemini agent orchestration
  Browserbase MCP tools
  browser skill loader
  SQLite run-state writer
  artifact/export generator

packages/shared
  shared schema contracts
  prompt and skill metadata contracts
  JSON schemas for runner/web handoff

data
  reacher.sqlite
  artifacts/
  exports/
```

The runtime flow:

```text
User prompt in Next.js chat
  -> AI SDK interprets intent and creates run
  -> SQLite stores run, prompt, requested platforms, and settings
  -> Python ADK runner picks up run
  -> Browserbase Search/Fetch performs cheap public recon
  -> Browserbase session opens with the relevant platform context
  -> agent loads platform skill and browses as logged-in user
  -> runner writes filters, targets, evidence, drafts, artifacts
  -> Next.js streams run status and renders lists/exports
  -> outreach mode opens targets, prepares drafts, stops before final send
```

## 6. Implementation Order

### Phase 0 - Planning Closure

Outputs:

- This planning folder.
- A stable list of architecture decisions.
- A packetized implementation backlog.

Rules:

- Do not generate application code.
- Do not introduce social APIs as a default dependency. Reddit is the explicit exception if official API-assisted access is required.
- Do not turn Reacher into a CRM.

### Phase 1 - Local App Foundation

Outputs:

- Next.js app shell under `apps/web`.
- Drizzle and SQLite setup.
- Base run/list/artifact schema.
- Local app navigation for chat, runs, lists, contexts, exports.

Rules:

- Keep the app deployable in principle, but optimize for local use.
- Treat Python runner as local runtime dependency, not a separate product backend.

### Phase 2 - Browserbase Context Onboarding

Outputs:

- Browserbase account configuration.
- One persistent context per platform.
- User-driven login flow for LinkedIn, X, Reddit, and Discord.
- Context verification UI and status states.

Rules:

- Never assume a context is logged in without verification.
- Keep platform contexts separate.
- Store Browserbase context identifiers in SQLite, not secrets in client code.

### Phase 3 - ADK Runner and Run Lifecycle

Outputs:

- Python ADK runner that can claim a run, stream progress, call Browserbase MCP tools, and write structured results.
- Run state machine and step log.
- Cancellation and recovery path.

Rules:

- Long-running work must not depend on a single HTTP request staying open.
- Every browser action that affects an external site must be logged with step text and timestamp.

### Phase 4 - Research and Filter Discovery

Outputs:

- Prompt-to-research-plan flow.
- Browserbase Search/Fetch public recon.
- Browser skill loading.
- Stored search queries, filters, candidate sources, targets, relevance scores, and evidence.

Rules:

- Research output must include filters and reasoning, not only a flat target list.
- Saved targets must explain why they matched.

### Phase 5 - Lists, Drafts, and Exports

Outputs:

- Saved filtered lists.
- Draft generation from target evidence.
- Markdown/CSV/JSON exports.
- Run artifact browser.

Rules:

- Drafts should cite saved evidence or mark the line as generic.
- Exports must be reproducible from SQLite state.

### Phase 6 - Outreach Preparation

Outputs:

- Select targets from a saved list.
- Open logged-in platform context.
- Navigate to profile/conversation.
- Paste or prepare draft.
- Stop before final manual send.
- Log status and screenshot/live session link if available.

Rules:

- v1 stops before final send.
- The operator can mark sent, skipped, failed, or needs follow-up.

## 7. Success Criteria

### 7.1 Architecture

- Planning folder exists at `reacher/plans/browser-agent-workbench`.
- All subplans link back to [plan.md](./plan.md).
- The plan consistently uses Next.js, SQLite/Drizzle, Python ADK, Gemini, Browserbase, and Vercel AI SDK.
- The plan does not require Postgres, FastAPI, NestJS, LangGraph, or Playwright for v1. Social APIs remain out of scope except for a Reddit API-assisted fallback.

### 7.2 Browser Identity

- The design supports one Browserbase context per platform.
- The onboarding flow lets the user manually log in and persist account state.
- Contexts have explicit status states: `needs_login`, `ready`, `expired`, `locked`, `error`.

### 7.3 Research Workflow

- A run can save discovered filters, search queries, candidate sources, targets, evidence, and target rankings.
- Browserbase Search/Fetch is used before interactive browsing when useful.
- Platform skills are loaded as browser playbooks, not API connectors, except the Reddit API-assisted fallback when required.

### 7.4 Outreach Workflow

- A saved list can be used as the input to an outreach preparation batch.
- The browser opens under the relevant logged-in platform context.
- The agent prepares the message and stops before final send.
- The app records the action result and evidence.

### 7.5 Deployment Posture

- Local-first development works with a file-backed SQLite database.
- Vercel deployment remains possible for the web app, with the known caveat that the Python runner needs an external runtime when not local.

## 8. Out of Scope

- Full CRM replacement features such as pipeline forecasting, company ownership hierarchies, revenue attribution, or team sales workflows.
- Postgres, FastAPI, NestJS, Temporal, BullMQ, and LangGraph for v1.
- Social-media APIs for LinkedIn, X, or Discord.
- Reddit API usage beyond the official API-assisted path needed for research and Devvit-supported post/comment write actions.
- Telegram.
- Autonomous final-send clicking in v1.
- CAPTCHA bypass, stealth browser evasion, proxy rotation, or account-farming systems.
- Multi-user SaaS hardening.
- Billing.

## 9. Risk Register

| Risk | Why it matters | Mitigation |
|---|---|---|
| Browser contexts expire or get logged out | Logged-in browsing is central to the product. | Add context verification, relogin flow, and per-platform status. |
| Browserbase MCP context attachment is insufficient for all needs | The runner must reliably start sessions with the right account. | Keep a BrowserDriver abstraction and allow direct Browserbase SDK/session API fallback. |
| Python runner and Drizzle schema drift | Web and runner both need the same database semantics. | Make Drizzle migrations the schema source of truth and document runner SQL access against migration outputs. |
| Long runs die when app restarts | Research and browsing can be slow. | Persist run state and step logs; runner can resume or mark interrupted. |
| Platform UI changes break browser playbooks | The product depends on web UI operation. | Keep skills editable Markdown, prefer observe/extract before act, capture failures as skill update candidates. |
| Vercel deployment cannot host local runner directly | Python browser runner is not a normal Next.js route. | Treat deployability as split-runtime: web on Vercel, runner on local machine or separate worker host. |
| Agent produces weak lists | Research is about filters, not scraping volume. | Store filters, inclusion/exclusion rules, evidence, and scoring reasons for inspection. |
| Drafts over-personalize without evidence | Bad outreach quality. | Draft generation must use saved evidence or mark generic angles. |

## 10. Agent Execution Contract

Every implementation agent should receive:

- [plan.md](./plan.md)
- [architecture-decisions.md](./architecture-decisions.md)
- The focused subplan for its area.
- One task packet from [agent-task-packets.md](./agent-task-packets.md).

Every implementation agent must return:

- Files changed.
- Commands run.
- Generated files changed.
- Tests/checks passed.
- Tests/checks skipped and why.
- Unresolved questions.

Agents must not:

- Add Postgres or a separate backend service for v1.
- Add social-media API dependencies for LinkedIn, X, or Discord.
- Add Reddit API writes, messaging, posting, voting, moderation, or account-state changes before a separate Reddit API write-action plan is accepted.
- Implement final-send automation in v1.
- Collapse platform contexts into one shared browser context.
- Replace Browserbase-first execution with Playwright-first execution unless a later decision log explicitly changes that.
- Treat `chatgpt-pro-scaffold.md` as source of truth when it conflicts with this plan.

## 11. Recommended First PRs

1. Create the monorepo scaffold with `apps/web`, `apps/runner`, and `packages/shared`.
2. Add Drizzle/SQLite schema and migrations for runs, browser contexts, filters, targets, drafts, actions, and artifacts.
3. Add Browserbase context onboarding UI and local configuration validation.
4. Add Python ADK runner skeleton with Browserbase MCP connectivity and a single smoke-test run.
5. Add first browser skills for LinkedIn, X, Reddit, and Discord as editable Markdown playbooks.
6. Add research run workflow with Search/Fetch, target list persistence, and Markdown export.
7. Add outreach preparation workflow that opens a target, prepares a draft, and stops before final send.
