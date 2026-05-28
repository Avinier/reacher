# Data Model Plan

> Parent plan: [plan.md](./plan.md)
> Scope: SQLite/Drizzle entities for runs, research filters, targets, drafts, actions, contexts, artifacts, and exports

## 1. Outcome

Reacher needs enough local structure to make agent runs inspectable, resumable, exportable, and useful. The data model should stay smaller than a CRM while preserving evidence and browser action history.

Drizzle owns schema and migrations. SQLite is the runtime database.

## 2. Ownership

| Component | Responsibility |
|---|---|
| `apps/web/db/schema/*` | Drizzle table definitions. |
| `apps/web/db/migrations/*` | Generated migrations. |
| `apps/web/lib/db/*` | Web-side data access. |
| `apps/runner/reacher_runner/db.py` | Runner-side SQL access against Drizzle-owned schema. |
| `packages/shared` | Shared enums and JSON payload contracts. |

## 3. Database Settings

Recommended local SQLite settings:

```sql
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
```

Rules:

- Drizzle migrations are committed.
- Python runner must not create tables outside migrations.
- Use JSON columns for agent payloads that are useful but not worth normalizing in v1.
- Normalize entities that drive UI tables, filtering, and exports.

## 4. Core Tables

### 4.1 `runs`

Purpose: one user-requested agent job.

```text
id
kind: research | outreach_prepare | export | context_verify
status: queued | claimed | running | waiting_for_context | waiting_for_operator | completed | failed | cancelled | interrupted
prompt
interpreted_goal
settings_json
result_summary
error_message
created_at
updated_at
started_at
completed_at
```

### 4.2 `run_steps`

Purpose: inspectable progress and browser action log.

```text
id
run_id
index
status: pending | running | completed | failed | skipped
kind: plan | search | fetch | browser_session | navigate | observe | act | extract | save | draft | export | operator_wait
title
detail
input_json
output_json
artifact_id
started_at
completed_at
```

### 4.3 `browser_contexts`

Purpose: one persistent logged-in Browserbase context per platform.

```text
id
platform: linkedin | x | reddit | discord
display_name
provider: browserbase
provider_context_id
status: needs_login | ready | expired | locked | error
account_label
last_verified_at
last_session_id
last_error
created_at
updated_at
```

### 4.4 `browser_sessions`

Purpose: session metadata for debugging and live viewing.

```text
id
run_id
browser_context_id
provider_session_id
status: starting | active | closed | failed
live_url
recording_url
started_at
ended_at
last_url
error_message
```

### 4.5 `research_filters`

Purpose: first-class saved discovery logic.

```text
id
run_id
platform: web | linkedin | x | reddit | discord
kind
value
reason
confidence
created_at
```

Examples:

- Reddit subreddit plus keyword plus recency.
- X search query with exclusion terms.
- LinkedIn profile search pattern.
- Discord server/channel navigation route.
- General web search query.

### 4.6 `sources`

Purpose: pages, searches, communities, profiles, and other places used during research.

```text
id
run_id
platform
source_type: search_result | page | profile | post | comment | server | channel | conversation | document
url
title
summary
captured_at
artifact_id
```

### 4.7 `targets`

Purpose: people, companies, communities, or accounts worth saving.

```text
id
run_id
list_id
platform: linkedin | x | reddit | discord | web
target_type: person | company | community | account | thread | page
display_name
handle
profile_url
organization
role_or_context
relevance_score
why_relevant
status: new | saved | drafted | prepared | sent_by_user | skipped | needs_review
metadata_json
created_at
updated_at
```

### 4.8 `target_evidence`

Purpose: evidence behind relevance and personalization.

```text
id
target_id
source_id
evidence_type: quote | observation | page_fact | profile_fact | activity_signal
text
url
confidence
created_at
```

### 4.9 `lists`

Purpose: saved filtered outreach/research lists.

```text
id
name
description
source_run_id
created_at
updated_at
```

### 4.10 `list_items`

Purpose: stable list membership and ordering.

```text
id
list_id
target_id
rank
notes
created_at
```

### 4.11 `drafts`

Purpose: message/reply drafts generated from saved evidence.

```text
id
target_id
run_id
platform
draft_type: dm | reply | connection_note | comment
body
evidence_summary
status: generated | edited | approved_for_prepare | prepared | discarded
created_at
updated_at
```

### 4.12 `outreach_actions`

Purpose: record prepared or user-completed outreach steps.

```text
id
run_id
target_id
draft_id
browser_session_id
platform
action_type: open_profile | open_composer | paste_draft | operator_sent | skipped | failed
status: queued | running | prepared | waiting_for_operator | done | failed
result_note
artifact_id
created_at
updated_at
```

### 4.13 `artifacts`

Purpose: local files and provider URLs created during runs.

```text
id
run_id
kind: screenshot | html | markdown | csv | json | recording | log | other
path
provider_url
title
metadata_json
created_at
```

### 4.14 `exports`

Purpose: generated exports from runs or lists.

```text
id
run_id
list_id
format: markdown | csv | json
artifact_id
created_at
```

## 5. Indexes

Required indexes:

```text
runs(status, created_at)
run_steps(run_id, index)
browser_contexts(platform)
browser_sessions(run_id)
research_filters(run_id)
sources(run_id)
targets(run_id)
targets(list_id)
targets(platform, status)
target_evidence(target_id)
list_items(list_id, rank)
drafts(target_id)
outreach_actions(run_id)
artifacts(run_id)
exports(run_id)
exports(list_id)
```

## 6. Data Flow

Research run:

```text
runs
  -> run_steps
  -> research_filters
  -> sources
  -> targets
  -> target_evidence
  -> lists/list_items
  -> artifacts/exports
```

Outreach preparation run:

```text
selected list_items
  -> drafts
  -> browser_sessions
  -> outreach_actions
  -> run_steps
  -> artifacts
```

## 7. Acceptance Criteria

- Drizzle schema can create all tables above.
- SQLite migrations run on a clean local database.
- Runner can insert run steps and targets using the migration-defined tables.
- Web app can query lists, targets, drafts, context statuses, and exports.
- Markdown export can be regenerated from database state.

## 8. Out of Scope

- Multi-tenant workspace isolation.
- Postgres-specific features.
- Vector search.
- Full CRM pipeline entities.
- Billing and team permissions.
