# Agent Task Packets

> Parent plan: [plan.md](./plan.md)
> Scope: copy-pasteable implementation prompts for future coding agents

Use these packets after the architecture/planning phase is accepted. Each packet has a disjoint primary write scope. Agents should read the parent plan and the relevant subplan before editing code.

## Packet 1 - Monorepo and Local App Foundation

Goal:

- Create the initial Reacher monorepo scaffold with a Next.js app, Python runner folder, shared package folder, and local data directory conventions.

Inputs:

- [plan.md](./plan.md)
- [architecture-decisions.md](./architecture-decisions.md)
- [web-app-ux-plan.md](./web-app-ux-plan.md)

Allowed write scope:

```text
reacher/package.json
reacher/pnpm-workspace.yaml
reacher/apps/web/**
reacher/apps/runner/**
reacher/packages/shared/**
reacher/data/.gitkeep
reacher/.env.example
reacher/README.md
```

Forbidden write scope:

```text
reacher/plans/**
```

Required outputs:

- Next.js app runs locally.
- Python runner folder has a minimal project skeleton.
- Shared package folder exists.
- `.env.example` lists `BROWSERBASE_API_KEY`, `BROWSERBASE_PROJECT_ID`, and `GOOGLE_API_KEY`.

Acceptance commands:

```sh
cd /Users/avinier/ssai/reacher
pnpm install
pnpm --filter web lint
```

Done criteria:

- App shell loads.
- No Postgres, FastAPI, NestJS, LangGraph, or social API dependencies are added.

## Packet 2 - SQLite and Drizzle Schema

Goal:

- Implement the SQLite/Drizzle schema for runs, steps, browser contexts, sessions, filters, sources, targets, evidence, lists, drafts, actions, artifacts, and exports.

Inputs:

- [data-model-plan.md](./data-model-plan.md)

Allowed write scope:

```text
reacher/apps/web/db/**
reacher/apps/web/lib/db/**
reacher/packages/shared/**
reacher/drizzle.config.*
```

Forbidden write scope:

```text
reacher/apps/runner/**
```

Required outputs:

- Drizzle schema and migration scripts.
- SQLite local database initialization.
- WAL and foreign key pragmas applied by the app data layer.

Acceptance commands:

```sh
cd /Users/avinier/ssai/reacher
pnpm db:generate
pnpm db:migrate
pnpm --filter web lint
```

Done criteria:

- Clean local database can be created.
- Tables match [data-model-plan.md](./data-model-plan.md).

## Packet 3 - Browserbase Context Onboarding

Goal:

- Build the UI and server-side operations for one Browserbase context per platform.

Inputs:

- [browserbase-contexts-plan.md](./browserbase-contexts-plan.md)
- [data-model-plan.md](./data-model-plan.md)

Allowed write scope:

```text
reacher/apps/web/app/contexts/**
reacher/apps/web/app/api/contexts/**
reacher/apps/web/lib/browserbase/**
reacher/apps/web/lib/db/**
reacher/packages/shared/**
```

Forbidden write scope:

```text
reacher/apps/runner/agents/**
```

Required outputs:

- Context list page.
- Per-platform context page.
- Server route to create/open login session.
- Server route to mark verification result.

Acceptance commands:

```sh
cd /Users/avinier/ssai/reacher
pnpm --filter web lint
pnpm --filter web test
```

Done criteria:

- UI supports LinkedIn, X, Reddit, and Discord contexts.
- Context records persist in SQLite.
- Browserbase API keys are not exposed to client components.

## Packet 4 - Python ADK Runner Skeleton

Goal:

- Implement a local Python runner that can claim queued runs, write run steps, and perform a Browserbase smoke test.

Inputs:

- [agent-runner-plan.md](./agent-runner-plan.md)
- [browserbase-contexts-plan.md](./browserbase-contexts-plan.md)

Allowed write scope:

```text
reacher/apps/runner/**
reacher/packages/shared/**
```

Forbidden write scope:

```text
reacher/apps/web/app/**
```

Required outputs:

- Python project setup.
- Runner command.
- SQLite connection.
- Run claim/execute/fail lifecycle.
- Browserbase driver skeleton.
- ADK/Gemini configuration.

Acceptance commands:

```sh
cd /Users/avinier/ssai/reacher/apps/runner
uv run python -m reacher_runner.main --once
uv run pytest
```

Done criteria:

- A queued run can be claimed and completed or failed.
- Runner writes visible run steps.
- Browserbase smoke test is implemented behind config gating.

## Packet 5 - Browser Skill System

Goal:

- Add editable browser skills and a loader that selects minimal skills by platform and run kind.

Inputs:

- [browser-skill-system-plan.md](./browser-skill-system-plan.md)
- [agent-runner-plan.md](./agent-runner-plan.md)

Allowed write scope:

```text
reacher/apps/runner/skills/**
reacher/apps/runner/reacher_runner/skills/**
reacher/apps/runner/tests/**
```

Forbidden write scope:

```text
reacher/apps/web/**
```

Required outputs:

- Global research and outreach preparation skills.
- LinkedIn, X, Reddit, and Discord skills.
- Skill loader with tests.

Acceptance commands:

```sh
cd /Users/avinier/ssai/reacher/apps/runner
uv run pytest
```

Done criteria:

- Loader returns global plus platform-specific skills for a run.
- Skill paths and hashes can be recorded.

## Packet 6 - Research Run Workflow

Goal:

- Implement the first end-to-end research run: prompt to filters, sources, targets, evidence, list, and export.

Inputs:

- [agent-runner-plan.md](./agent-runner-plan.md)
- [browser-skill-system-plan.md](./browser-skill-system-plan.md)
- [exports-and-artifacts-plan.md](./exports-and-artifacts-plan.md)

Allowed write scope:

```text
reacher/apps/runner/reacher_runner/agents/**
reacher/apps/runner/reacher_runner/browserbase/**
reacher/apps/runner/reacher_runner/artifacts/**
reacher/apps/runner/reacher_runner/exports/**
reacher/apps/web/app/runs/**
reacher/apps/web/app/lists/**
reacher/apps/web/lib/db/**
```

Forbidden write scope:

```text
reacher/apps/web/app/contexts/**
```

Required outputs:

- Research agent.
- Search/Fetch use where configured.
- Target and evidence persistence.
- Run detail UI for steps, filters, sources, targets.
- Markdown export.

Acceptance commands:

```sh
cd /Users/avinier/ssai/reacher
pnpm --filter web lint
cd /Users/avinier/ssai/reacher/apps/runner
uv run pytest
```

Done criteria:

- A prompt can produce a saved list with targets and evidence.
- Export includes strategy, filters, and targets.

## Packet 7 - Drafts and Outreach Preparation

Goal:

- Generate drafts from saved evidence and prepare messages in the logged-in browser while stopping before final send.

Inputs:

- [web-app-ux-plan.md](./web-app-ux-plan.md)
- [agent-runner-plan.md](./agent-runner-plan.md)
- [browserbase-contexts-plan.md](./browserbase-contexts-plan.md)

Allowed write scope:

```text
reacher/apps/web/app/drafts/**
reacher/apps/web/app/outreach/**
reacher/apps/web/app/targets/**
reacher/apps/runner/reacher_runner/agents/outreach_prepare_agent.py
reacher/apps/runner/reacher_runner/exports/**
reacher/apps/runner/skills/**
```

Forbidden write scope:

```text
reacher/apps/web/db/migrations/**
```

Required outputs:

- Draft review UI.
- Outreach preparation UI.
- Runner action flow that opens target, prepares composer, pastes draft, and stops.
- Outcome marking.

Acceptance commands:

```sh
cd /Users/avinier/ssai/reacher
pnpm --filter web lint
cd /Users/avinier/ssai/reacher/apps/runner
uv run pytest
```

Done criteria:

- User can select targets from a saved list and start an outreach preparation run.
- The agent stops before final send.
- User can mark sent, skipped, failed, or needs follow-up.

## Packet 8 - Export and Artifact Browser

Goal:

- Build artifact browsing and Markdown/CSV/JSON export regeneration from SQLite state.

Inputs:

- [exports-and-artifacts-plan.md](./exports-and-artifacts-plan.md)
- [data-model-plan.md](./data-model-plan.md)

Allowed write scope:

```text
reacher/apps/web/app/exports/**
reacher/apps/web/app/runs/[runId]/**
reacher/apps/web/lib/exports/**
reacher/apps/runner/reacher_runner/exports/**
reacher/apps/runner/reacher_runner/artifacts/**
```

Forbidden write scope:

```text
reacher/apps/web/db/schema/**
```

Required outputs:

- Export index page.
- Run/list export download links.
- Markdown/CSV/JSON generation.
- Artifact list on run detail.

Acceptance commands:

```sh
cd /Users/avinier/ssai/reacher
pnpm --filter web lint
cd /Users/avinier/ssai/reacher/apps/runner
uv run pytest
```

Done criteria:

- Completed research run can export Markdown, CSV, and JSON.
- Markdown includes filters, evidence, and targets.
