# Agent Runner Plan

> Parent plan: [plan.md](./plan.md)
> Scope: Python Google ADK runner, Gemini orchestration, Browserbase tool use, and run lifecycle

## 1. Outcome

The runner executes long-running Reacher jobs outside the Next.js request lifecycle. It reads pending runs from SQLite, uses Google ADK with Gemini, operates Browserbase sessions through MCP or an internal Browserbase driver, writes progress and structured results back to SQLite, and produces artifacts/exports.

## 2. Ownership

| Component | Responsibility |
|---|---|
| `apps/runner` | ADK agents, Browserbase driver, skill loading, run execution, exports, artifact writes. |
| `apps/web` | Creates runs, displays state, streams logs, provides user controls. |
| SQLite | Durable local run state and handoff channel. |
| Browserbase | Browser execution, contexts, live session, recordings. |
| Gemini | Agent reasoning and structured extraction/generation. |

## 3. Required Files or Artifacts

Future implementation should create:

```text
apps/runner/pyproject.toml
apps/runner/reacher_runner/__init__.py
apps/runner/reacher_runner/main.py
apps/runner/reacher_runner/config.py
apps/runner/reacher_runner/db.py
apps/runner/reacher_runner/runs/claim.py
apps/runner/reacher_runner/runs/executor.py
apps/runner/reacher_runner/agents/research_agent.py
apps/runner/reacher_runner/agents/outreach_prepare_agent.py
apps/runner/reacher_runner/browserbase/driver.py
apps/runner/reacher_runner/skills/loader.py
apps/runner/reacher_runner/artifacts/writer.py
apps/runner/reacher_runner/exports/markdown.py
```

## 4. Run Lifecycle

Run statuses:

```text
queued
claimed
running
waiting_for_context
waiting_for_operator
completed
failed
cancelled
interrupted
```

Step statuses:

```text
pending
running
completed
failed
skipped
```

Runner loop:

```text
load config
open SQLite
claim next queued run atomically
mark run claimed/running
load run prompt and settings
load relevant skills
execute task plan
write run_steps as progress happens
write filters, targets, drafts, actions, artifacts
mark completed/failed/cancelled
```

Rules:

- Runner must be restartable.
- A run should never disappear if the runner crashes.
- Every external browser operation should create or update a `run_steps` row.
- Cancellation should be checked between browser actions.

## 5. Agent Types

### 5.1 Research Agent

Responsibilities:

- Interpret user prompt.
- Identify useful platforms and public sources.
- Generate initial query/filter hypotheses.
- Use Browserbase Search/Fetch for public recon.
- Decide when an authenticated browser session is needed.
- Load platform browser skills.
- Save filters, sources, targets, evidence, and ranking reasons.

Output shape:

```json
{
  "interpreted_goal": "...",
  "platforms": ["x", "reddit"],
  "filters": [
    {
      "platform": "reddit",
      "kind": "subreddit_keyword_recency",
      "value": "r/SaaS + outbound + last 90 days",
      "why": "..."
    }
  ],
  "targets": [
    {
      "platform": "x",
      "profile_url": "https://x.com/example",
      "display_name": "Example",
      "why_relevant": "...",
      "evidence": ["..."]
    }
  ]
}
```

### 5.2 Outreach Prepare Agent

Responsibilities:

- Load selected saved targets and drafts.
- Start the correct platform Browserbase context.
- Navigate to target profile or conversation path.
- Open message/reply composer where feasible.
- Paste or stage the draft.
- Stop before final send.
- Write action outcome.

Rules:

- V1 does not click final send.
- If the agent cannot confidently find the message UI, it should stop and mark `needs_operator`.

### 5.3 Export Agent

Responsibilities:

- Generate Markdown, CSV, and JSON exports from SQLite.
- Include research strategy, filters, targets, evidence, and draft angle.
- Save files under local `data/exports`.

## 6. Browserbase Driver

The runner should hide Browserbase implementation details behind a driver.

Driver interface:

```text
search(query, options)
fetch(url, options)
create_session(platform, context_id, run_id)
get_live_url(session_id)
navigate(session_id, url)
observe(session_id, instruction)
act(session_id, instruction)
extract(session_id, instruction, schema)
capture_screenshot(session_id)
close_session(session_id, persist_context)
```

Initial implementation:

- Prefer Browserbase MCP with Google ADK.
- Verify context binding behavior during implementation.
- Fall back to direct Browserbase SDK/API for session creation if MCP does not expose all session options.

## 7. Skill Loading

The runner loads skills from:

```text
apps/runner/skills/global/
apps/runner/skills/linkedin/
apps/runner/skills/x/
apps/runner/skills/reddit/
apps/runner/skills/discord/
```

Loading triggers:

- User explicitly names a platform.
- Browser URL host matches platform.
- Agent chooses a platform as part of research strategy.
- Outreach target has a platform.

Rules:

- Skills are instructions and examples, not API clients.
- Skills should prefer observe/extract before act.
- Skills should include failure cues and recovery notes.

## 8. Next.js Handoff

Local run creation flow:

```text
POST /api/runs
  -> validate prompt/settings
  -> insert run with status queued
  -> optionally signal local runner
  -> return run id
```

Runner pickup options:

| Option | Description | Recommendation |
|---|---|---|
| Polling | Runner polls SQLite for queued runs. | Start here. |
| Local process spawn | Next.js starts runner for one run. | Useful for dev, but less robust. |
| WebSocket/event bridge | Runner pushes live events. | Later polish. |

V1 should use polling plus SQLite step logs. The UI can poll or subscribe through a simple local route.

## 9. Acceptance Criteria

- Runner can claim a queued run and mark it completed or failed.
- Runner writes visible run steps to SQLite.
- Runner can call a Browserbase smoke test with a configured context.
- Research agent can save at least one filter, source, target, and evidence record.
- Outreach prepare agent can open a selected target and stop before final send.
- Runner can be stopped and restarted without losing queued runs.

## 10. Out of Scope

- Distributed workers.
- Queue infrastructure beyond SQLite polling.
- Temporal, BullMQ, Redis, or Postgres.
- Autonomous final-send clicking.
- Social-media API clients.
