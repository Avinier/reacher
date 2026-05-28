# Exports and Artifacts Plan

> Parent plan: [plan.md](./plan.md)
> Scope: local files, evidence capture, run artifacts, and export formats

## 1. Outcome

Reacher should preserve enough local evidence for the user to trust, review, reuse, and export the agent's work. Exports should include not only targets, but also the filters and reasoning that produced them.

## 2. Ownership

| Component | Responsibility |
|---|---|
| `apps/runner/artifacts` | Write screenshots, HTML snapshots, logs, and exports. |
| `apps/web` | Display artifacts and provide download links. |
| SQLite | Store artifact metadata and relationships. |
| Browserbase | Provide session recordings/live links where available. |

## 3. Local File Layout

Recommended local layout:

```text
data/
  reacher.sqlite
  artifacts/
    runs/
      <run-id>/
        screenshots/
        html/
        logs/
  exports/
    runs/
      <run-id>/
        research.md
        targets.csv
        targets.json
    lists/
      <list-id>/
        list.md
        list.csv
        list.json
```

Rules:

- Store absolute paths in SQLite only when necessary; otherwise store paths relative to `data/`.
- Exports should be regenerable from SQLite where possible.
- Browserbase recording URLs can be stored as provider URLs.

## 4. Artifact Types

| Kind | Purpose |
|---|---|
| `screenshot` | Evidence of page state, context verification, or outreach preparation. |
| `html` | Snapshot for later inspection or extraction debugging. |
| `markdown` | Human-readable export. |
| `csv` | Spreadsheet-friendly target export. |
| `json` | Structured export for reuse. |
| `recording` | Browserbase session recording link. |
| `log` | Runner-side text or JSONL logs. |

## 5. Markdown Export Format

Research/list Markdown exports should follow this shape:

```markdown
# <List or Run Name>

Generated: <timestamp>
Prompt: <original prompt>
Interpreted goal: <interpreted goal>

## Strategy

### Platforms Used

- <platform>

### Filters Found

| Platform | Filter | Why |
|---|---|---|
| Reddit | ... | ... |

### Search Queries

- ...

## Summary

- Targets found: <n>
- Saved targets: <n>
- Drafts generated: <n>
- Needs review: <n>

## Targets

### <Target name>

- Platform: <platform>
- URL: <url>
- Relevance score: <score>
- Why relevant: <reason>
- Draft angle: <angle>

Evidence:

- <evidence item with source URL>

Draft:

> <draft body if included>
```

Rules:

- Include filters and search strategy.
- Include evidence URLs.
- Do not include secrets or Browserbase API keys.
- Draft inclusion should be configurable.

## 6. CSV Export Format

Columns:

```text
rank
platform
target_type
display_name
handle
profile_url
organization
role_or_context
relevance_score
why_relevant
evidence_count
draft_status
outreach_status
source_run_id
```

Rules:

- Keep CSV flat.
- Put long evidence details in Markdown/JSON, not CSV.

## 7. JSON Export Format

Top-level shape:

```json
{
  "generated_at": "...",
  "prompt": "...",
  "interpreted_goal": "...",
  "filters": [],
  "sources": [],
  "targets": [],
  "drafts": []
}
```

Rules:

- JSON should be stable enough for future imports.
- Include IDs from the local database.

## 8. Evidence Capture Rules

Capture evidence when:

- A target is saved.
- A filter is adopted because of a page observation.
- A draft uses a personalization fact.
- Outreach preparation reaches the message composer.
- Context verification passes or fails.

Evidence can be:

- URL.
- Short page observation.
- Extracted text.
- Screenshot artifact.
- HTML artifact.
- Browserbase recording URL.

## 9. Acceptance Criteria

- Each completed research run has a Markdown export.
- Each saved list can export Markdown, CSV, and JSON.
- Exports include filters and evidence, not only target rows.
- Artifact metadata is queryable by run and target.
- Outreach preparation can save a screenshot or session link.

## 10. Out of Scope

- Cloud object storage.
- Public share links.
- PDF export.
- Full data import workflow.
