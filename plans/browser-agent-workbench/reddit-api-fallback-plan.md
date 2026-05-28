# Reddit API Fallback Plan

> Parent plan: [plan.md](./plan.md)
> Scope: official Reddit API-assisted access and write actions when Browserbase browser login is blocked

## 1. Outcome

Reddit should remain useful in Reacher even when Browserbase web login is blocked by network-security or developer-token gating. V1 should add an official Reddit API-assisted path for research, list building, and approved write actions, while keeping LinkedIn, X, and Discord browser-native.

Current local status:

- Devvit CLI login verified as `u/_AVINIER`.
- Devvit app created as `reacher-usage`.
- Devvit playtest subreddit configured as `reacher_usage_dev`.
- Upload succeeded at version `v0.0.3`; playtest currently serves `v0.0.3.1`.
- Playtest URL: [https://www.reddit.com/r/reacher_usage_dev/?playtest=reacher-usage](https://www.reddit.com/r/reacher_usage_dev/?playtest=reacher-usage)

## 2. Why This Exists

During Browserbase context setup, Reddit blocked manual login with a network-security/developer-token flow. That makes Reddit different from the other platforms.

Decision:

- Browserbase remains the default browser substrate.
- Reddit gets an explicit API-assisted exception.
- V1 Reddit write access should use Devvit user actions where possible.
- Posting/commenting must be explicit operator action, not hidden automation.

## 3. Official Sources

- [Reddit API overview](https://developers.reddit.com/docs/capabilities/server/reddit-api)
- [Reddit Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
- [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms)
- [Reddit Developer Terms](https://redditinc.com/policies/developer-terms)
- [Reddit API documentation](https://www.reddit.com/dev/api/)
- [Reddit User Actions](https://developers.reddit.com/docs/capabilities/server/userActions)
- [Devvit app configuration](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_configuration)
- [Devvit CLI](https://developers.reddit.com/docs/guides/tools/devvit_cli)

## 4. Required Environment Variables

For Devvit, Reddit's current docs say you do not create traditional Reddit API keys for a Devvit app. Devvit handles authentication after CLI login and app setup.

Useful local variables:

```text
DEVVIT_SUBREDDIT=reacher_usage_dev
DEVVIT_APP_NAME=reacher-usage
```

Rules:

- `npx devvit login` stores the Devvit access token locally at `~/.devvit/token`; do not copy that token into `.env`.
- Do not commit Devvit local tokens.
- If a later traditional OAuth Data API path is accepted, add `REDDIT_CLIENT_ID`, `REDDIT_CLIENT_SECRET`, `REDDIT_REDIRECT_URI`, `REDDIT_REFRESH_TOKEN`, and `REDDIT_USER_AGENT` in a separate plan.
- Mask all token values in logs.

## 5. V1 Capabilities

Allowed in v1:

- Search subreddits.
- Read public subreddit posts.
- Read public comments.
- Inspect public user profiles.
- Save sources, filters, targets, and evidence.
- Generate drafts from saved evidence.
- Submit posts through Devvit where supported.
- Submit comments through Devvit where supported.
- Send app-account private messages through Devvit where supported.

Allowed only with explicit operator action:

- `runAs: "USER"` post submission.
- `runAs: "USER"` comment submission.
- App-account post/comment submission.
- App-account private messages.

Not allowed in v1 without a separate accepted plan:

- User-attributed Reddit DMs.
- Vote, save, follow, moderate, or modify account state.
- Subscribe users to subreddits.

## 6. Architecture

```text
Research Agent
  -> try Browserbase Search/Fetch or public web path
  -> if Reddit browser path blocked and API configured:
       use Reddit API reader
  -> store filters/sources/targets/evidence in same SQLite schema

Reddit Write Agent
  -> load approved draft/action from Reacher
  -> route through Devvit app endpoint/menu/form
  -> require explicit operator action
  -> call reddit.submitPost, reddit.submitComment, or reddit.sendPrivateMessage where supported
  -> store action result and permalink/evidence
```

The UI should show whether a Reddit result came from:

- Browserbase browser session.
- Browserbase Search/Fetch.
- Reddit API-assisted access.

## 7. Implementation Ownership

| Component | Responsibility |
|---|---|
| `apps/reddit-devvit` | Devvit app for Reddit API access and supported write actions. |
| `apps/runner/reacher_runner/reddit_api/*` | Read/write orchestration against the Devvit path or future API path. |
| `apps/runner/reacher_runner/agents/research_agent.py` | Select Reddit API fallback when needed. |
| `apps/runner/reacher_runner/agents/reddit_write_agent.py` | Prepare explicit Reddit write actions. |
| `apps/web/settings` | Show Reddit API configuration status, without secrets. |
| SQLite | Store source method and evidence provenance. |

## 8. Devvit Setup Steps

1. Create or connect a Reddit developer account at [developers.reddit.com](https://developers.reddit.com/). Completed for `u/_AVINIER`.
2. Install/use the Devvit CLI in the project:

```sh
npm install --save-dev devvit@latest
npx devvit login
npx devvit whoami
```

3. Create a Devvit app through [developers.reddit.com/new](https://developers.reddit.com/new) or `npx devvit new`. Completed as `reacher-usage`.
4. Configure `devvit.json` with a valid app `name`, a `server` entry, and Reddit permissions. Current file: `apps/reddit-devvit/devvit.json`.

```json
{
  "$schema": "https://developers.reddit.com/schema/config-file.v1.json",
  "name": "reacher-usage",
  "server": {
    "entry": "src/server/index.js"
  },
  "permissions": {
    "reddit": {
      "enable": true,
      "asUser": ["SUBMIT_POST", "SUBMIT_COMMENT"]
    }
  }
}
```

5. Use a test subreddit for playtest. Current dev subreddit: `reacher_usage_dev`.

```sh
npx devvit upload
npx devvit playtest <test-subreddit-name>
```

6. Upload is complete for version `v0.0.3`; current playtest build is `v0.0.3.1`.
7. For broad user-account write access, publish/submit the app version and get approval for user actions. During playtest/unapproved versions, `runAs: "USER"` behavior is limited as documented by Reddit.

## 9. Local Commands

From repo root:

```sh
pnpm reddit:whoami
pnpm reddit:build
pnpm reddit:upload
pnpm reddit:dev
```

Current verification:

- `pnpm reddit:whoami` reports `u/_AVINIER`.
- `pnpm reddit:build` passes.
- `pnpm reddit:upload` succeeds.
- `pnpm reddit:dev` starts playtest `v0.0.3.1` at `https://www.reddit.com/r/reacher_usage_dev/?playtest=reacher-usage`.

## 10. Acceptance Criteria

- If Reddit Browserbase login is blocked, the run records a clear blocked state.
- If Devvit is configured, the research agent can read supported subreddit, post, comment, and profile data.
- If Devvit user actions are configured, the system can submit supported posts/comments only after explicit operator action.
- If app-account private messaging is configured, the system can queue and execute supported private messages only after explicit operator action.
- All Reddit API-derived records include source method `reddit_api`.
- Reddit write action results are logged with permalink/evidence.
- Missing Reddit credentials do not break non-Reddit runs.

## 11. Open Setup Questions

- Does the product need user-attributed DMs later, or are app-account private messages acceptable for v1?
- Does Reacher need app-account writes, user-account writes, or both?
- Does the intended use require launch review before useful operation?
