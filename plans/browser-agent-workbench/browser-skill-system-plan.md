# Browser Skill System Plan

> Parent plan: [plan.md](./plan.md)
> Scope: platform browser playbooks loaded by the ADK runner

## 1. Outcome

Reacher should handle LinkedIn, X, Reddit, and Discord through browser skills: editable instructions, page cues, extraction schemas, and action recipes that help the agent operate web UIs through Browserbase.

These are not API connectors by default. Reddit is the explicit exception if official API-assisted access is needed because browser login is blocked or developer-token-gated.

## 2. Ownership

| Component | Responsibility |
|---|---|
| `apps/runner/skills` | Markdown browser skills and examples. |
| `apps/runner/reacher_runner/skills/loader.py` | Skill discovery and loading. |
| ADK agents | Use relevant skills while browsing. |
| SQLite | Store which skills were used on a run. |

## 3. Required Files or Artifacts

Future implementation should create:

```text
apps/runner/skills/global/research.md
apps/runner/skills/global/outreach_prepare.md
apps/runner/skills/linkedin/research.md
apps/runner/skills/linkedin/message_prepare.md
apps/runner/skills/linkedin/page_cues.md
apps/runner/skills/x/research.md
apps/runner/skills/x/dm_prepare.md
apps/runner/skills/x/page_cues.md
apps/runner/skills/reddit/research.md
apps/runner/skills/reddit/message_prepare.md
apps/runner/skills/reddit/page_cues.md
apps/runner/skills/discord/research.md
apps/runner/skills/discord/message_prepare.md
apps/runner/skills/discord/page_cues.md
```

## 4. Skill Format

Each skill file should use predictable sections:

```markdown
# <Platform> <Task> Skill

## When To Use

## Goals

## Page Cues

## Research Moves

## Extraction Targets

## Action Recipes

## Failure Cues

## Stop Conditions

## Output Requirements
```

Rules:

- Skills describe how to use the browser UI.
- Skills should include what to observe before acting.
- Skills should include stop conditions when the UI is ambiguous.
- Skills should be short enough to load selectively.

## 5. Global Skills

### 5.1 Global Research

Must teach the agent to:

- Turn vague user prompts into search/filter hypotheses.
- Use Browserbase Search/Fetch before interactive sessions.
- Save filters and why they matter.
- Save evidence for each target.
- Avoid over-collecting low-fit targets.

### 5.2 Global Outreach Prepare

Must teach the agent to:

- Use saved drafts and target URLs.
- Open the right platform context.
- Prepare the message in the browser.
- Stop before final send.
- Record status and artifacts.

## 6. Platform Skills

### 6.1 LinkedIn

Initial task coverage:

- Profile/company page enrichment.
- Search result inspection.
- Message composer discovery.
- Draft paste and stop.

Useful page cues:

- Logged-out wall.
- Profile not found.
- Connect-only state.
- Message button available.
- Premium/limited messaging state.

Stop conditions:

- Cannot identify target profile.
- Message UI is unavailable.
- Page shows challenge, verification, or login wall.

### 6.2 X

Initial task coverage:

- Profile research.
- Search query/filter exploration.
- Recent activity relevance.
- DM composer discovery.
- Draft paste and stop.

Useful page cues:

- Logged-out wall.
- Protected account.
- DMs unavailable.
- Profile suspended/not found.

Stop conditions:

- DM button absent.
- Account is protected and inaccessible.
- Composer cannot be confidently identified.

### 6.3 Reddit

Initial task coverage:

- Subreddit discovery.
- Post/comment/user relevance research.
- Profile inspection.
- Message/chat/reply preparation where available.
- API-assisted read research when browser access is blocked.

Useful page cues:

- Subreddit rules/sidebar.
- User profile posts/comments.
- Login wall.
- Private/quarantined/restricted communities.

Stop conditions:

- Community rules are unavailable or block the intended action.
- Message/reply composer cannot be confidently found.
- User profile cannot be opened.
- Browser session is blocked by Reddit network security or developer-token gating.

Fallback:

- Use official Reddit API-assisted research for read-only subreddit/post/comment/user discovery when configured.
- Do not use Reddit API for v1 messaging, posting, commenting, voting, moderation, or account-state changes without a separate accepted plan.

### 6.4 Discord

Initial task coverage:

- Navigate web Discord with logged-in account.
- Inspect available servers/channels where already joined.
- Summarize channels or conversations visible to the user.
- Prepare reply or DM draft and stop.

Useful page cues:

- Login screen.
- Server/channel unavailable.
- Permission denied.
- Message box available.
- Read-only channel.

Stop conditions:

- The account is not joined to the needed server.
- Channel is read-only.
- The message box is unavailable.

## 7. Skill Selection

Selection signals:

```text
platform requested by user
target.platform
current browser URL host
run kind
agent plan step
```

The runner should load:

- One global skill for the run kind.
- One platform skill for the active platform.
- Optional page cues for the current host.

It should not load every skill for every run.

## 8. Skill Versioning

Future schema:

```text
skills_used
  id
  run_id
  skill_path
  skill_version_hash
  loaded_at
```

This makes failed runs debuggable when skills change.

## 9. Acceptance Criteria

- Skills exist for global research and outreach preparation.
- Each platform has research, message preparation, and page cue skills.
- Runner can load a minimal skill set by platform and run type.
- Run logs record which skill files were loaded.
- A failed browser action can be traced back to the skill used.

## 10. Out of Scope

- Platform API wrappers, except the Reddit API-assisted read fallback.
- Static site scrapers as the main integration.
- Complex plugin marketplace.
- Auto-updating skills from remote sources.
