# Web App UX Plan

> Parent plan: [plan.md](./plan.md)
> Scope: Next.js local app surfaces, user workflows, and UI responsibilities

## 1. Outcome

The web app should be a compact local command center for operating Reacher. It should expose chat-first run creation, browser context onboarding, run visibility, saved lists, target details, drafts, exports, and outreach preparation state.

It should not look or behave like a full CRM.

## 2. Ownership

| Component | Responsibility |
|---|---|
| Next.js App Router | Pages, layouts, route handlers, server actions. |
| Vercel AI SDK | Chat streaming and lightweight model calls. |
| Drizzle/SQLite | Local state and query layer. |
| Python runner | Long-running job execution, surfaced through run state. |

## 3. Primary Navigation

Recommended routes:

```text
/
/runs
/runs/[runId]
/lists
/lists/[listId]
/targets/[targetId]
/drafts
/outreach
/contexts
/contexts/[platform]
/exports
/settings
```

## 4. Core Screens

### 4.1 Home / Command

Purpose:

- Chat-first prompt entry.
- Start research run.
- Start outreach preparation from a saved list.
- Show recent runs and context readiness.

Required UI:

- Prompt box.
- Platform toggles: Web, LinkedIn, X, Reddit, Discord.
- Run type: research, outreach prepare, export.
- Context readiness badges.
- Recent run list.

Rules:

- If a selected platform context is not ready, show relogin/verify path before running authenticated tasks.
- Do not bury context failures in logs only.

### 4.2 Run Detail

Purpose:

- Show what the agent is doing and what it found.

Required UI:

- Run status and prompt.
- Step timeline.
- Active Browserbase live session link when present.
- Search queries and filters found.
- Sources visited.
- Targets found.
- Drafts generated.
- Artifacts and exports.
- Cancel button.

Rules:

- Step logs should be readable to a non-engineer.
- Browser live links should be easy to find during active sessions.

### 4.3 Contexts

Purpose:

- Manage one Browserbase context per platform.

Required UI:

- Platform cards for LinkedIn, X, Reddit, Discord.
- Status: needs login, ready, expired, locked, error.
- Account label if available.
- Last verified timestamp.
- Buttons: Create, Open Login Session, Verify, Relogin, Disable.

Rules:

- Login occurs in Browserbase live session.
- Never collect social passwords in Reacher UI.

### 4.4 Lists

Purpose:

- Store and inspect filtered target lists produced by research runs.

Required UI:

- List table.
- Target count.
- Platforms represented.
- Source run.
- Export actions.
- Start outreach preparation.

Target table columns:

```text
Rank
Platform
Name / handle
Context
Why relevant
Evidence count
Draft status
Preparation status
```

Rules:

- Lists should emphasize relevance and evidence, not sales pipeline stages.

### 4.5 Target Detail

Purpose:

- Inspect why a target was saved and what can be done next.

Required UI:

- Profile URL and platform.
- Why relevant.
- Evidence list with source links.
- Drafts.
- Outreach actions.
- Artifacts.
- Notes.

Rules:

- Drafts must show evidence summary.
- If evidence is weak, the UI should make that visible.

### 4.6 Drafts

Purpose:

- Review generated messages before using outreach preparation.

Required UI:

- Draft table grouped by list/run.
- Body preview.
- Evidence summary.
- Edit action.
- Mark approved for prepare.
- Discard action.

Rules:

- Approval here means approved for browser preparation, not automatic final send.

### 4.7 Outreach Preparation

Purpose:

- Let the user pick a saved list and ask the agent to prepare messages in the browser.

Required UI:

- Select list.
- Select platform subset.
- Select targets.
- Choose draft style or existing drafts.
- Start preparation.
- Active browser session panel.
- Status per target: queued, opened, composer found, draft pasted, waiting for operator, done, failed.
- Mark sent/skipped/failed controls.

Rules:

- V1 stops before final send.
- User outcome marking is required to close the loop.

### 4.8 Exports

Purpose:

- Generate and download Markdown, CSV, and JSON exports.

Required UI:

- Export list by run/list.
- Download links.
- Regenerate action.
- Include filters/evidence toggle.

Rules:

- Markdown exports should be human-readable and complete enough to share.

## 5. AI SDK Usage

Use Vercel AI SDK for:

- Chat streaming.
- Lightweight intent parsing before creating a run.
- Draft rewrites and summaries that do not require browser execution.
- Structured UI responses.

Do not use AI SDK route handlers for:

- Long-running Browserbase sessions.
- Multi-minute research runs.
- Outreach preparation loops.

## 6. Local Runner Controls

The UI should expose runner state:

```text
runner unavailable
runner idle
runner running
runner error
```

V1 can implement this with a local health file, route, or polling table field. The specific mechanism is implementation detail.

## 7. Acceptance Criteria

- User can create a research run from the home page.
- User can see run steps update.
- User can onboard and verify each platform context.
- User can inspect saved filters and targets.
- User can export a list as Markdown.
- User can start outreach preparation from a saved list.
- UI makes clear that final send is manual in v1.

## 8. Out of Scope

- Multi-user admin.
- CRM pipeline views.
- Email campaign tooling.
- Billing.
- Mobile-first optimization.
