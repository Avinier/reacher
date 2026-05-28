# Environment and Secrets Plan

> Parent plan: [plan.md](./plan.md)
> Scope: local environment variables, secret naming, and handling rules

## 1. Outcome

Reacher needs local secrets for Browserbase and Gemini/Google agent execution. The plan records required variable names and mapping rules, but must never store real secret values in committed Markdown, source files, or examples.

## 2. Required Secret Groups

### 2.1 Browserbase

Required:

```text
BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID
```

Used by:

- Next.js server routes for context/session onboarding.
- Python runner for Browserbase sessions, contexts, and MCP/SDK calls.

### 2.2 Gemini / Google ADK

The user has separate Google keys for:

```text
GOOGLE_GEMINI_API_KEY
GOOGLE_AGENT_PLATFORM_API_KEY
```

Implementation should support these names and map them to library-specific expected names where needed:

```text
GOOGLE_API_KEY
GEMINI_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY
```

Recommended mapping:

| App area | Preferred input | Library-compatible alias |
|---|---|---|
| Python ADK runner with Gemini | `GOOGLE_GEMINI_API_KEY` | `GOOGLE_API_KEY` or `GEMINI_API_KEY` |
| Next.js Vercel AI SDK Google provider | `GOOGLE_GEMINI_API_KEY` | `GOOGLE_GENERATIVE_AI_API_KEY` |
| Future Google Agent Platform work | `GOOGLE_AGENT_PLATFORM_API_KEY` | Keep separate until the SDK path is chosen. |

Rules:

- Do not assume `GOOGLE_AGENT_PLATFORM_API_KEY` can replace the Gemini API key for all local SDK calls.
- During implementation, verify the exact env names required by the installed ADK and AI SDK packages.
- Prefer explicit startup validation with helpful errors.

## 3. Non-Secret Local Configuration

Recommended:

```text
DATABASE_URL=file:./data/reacher.sqlite
REACHER_DATA_DIR=./data
REACHER_RUNNER_POLL_INTERVAL_MS=1000
REACHER_SECRET_KEY=<local random value>
```

`REACHER_SECRET_KEY` is secret-like and should still not be committed with a real value.

## 4. Local Files

Future implementation should provide:

```text
reacher/.env.example
reacher/.env.local
reacher/apps/runner/.env.example
```

Rules:

- `.env.example` contains names and comments only.
- `.env.local` contains real local values and must be gitignored.
- If the runner has its own env file, it must be gitignored too.
- Never write real Browserbase or Google keys into planning docs.

## 5. Startup Validation

Both app and runner should fail early with clear errors.

Next.js should validate:

```text
BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID
GOOGLE_GEMINI_API_KEY or GOOGLE_GENERATIVE_AI_API_KEY
DATABASE_URL
```

Python runner should validate:

```text
BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID
GOOGLE_GEMINI_API_KEY or GOOGLE_API_KEY or GEMINI_API_KEY
DATABASE_URL
```

If `GOOGLE_AGENT_PLATFORM_API_KEY` is absent, the runner should only warn if a future Agent Platform-specific feature is being used.

### 2.3 Reddit / Devvit

For the current Reddit Developer Platform path, do not store a Reddit client secret in `.env` unless a later traditional OAuth plan is accepted.

Devvit local authentication:

```sh
npx devvit login
npx devvit whoami
```

The Devvit CLI stores its token locally at `~/.devvit/token`. That token must not be copied into this repository.

Useful non-secret variables:

```text
DEVVIT_SUBREDDIT=reacher_usage_dev
DEVVIT_APP_NAME=reacher-usage
```

Only add these traditional OAuth variables if a separate Reddit Data API OAuth path is approved:

```text
REDDIT_CLIENT_ID
REDDIT_CLIENT_SECRET
REDDIT_REDIRECT_URI
REDDIT_REFRESH_TOKEN
REDDIT_USER_AGENT
```

## 6. Handling Keys Shared In Chat

The implementation plan should treat any real keys shared in conversation as local setup material only.

Rules:

- Do not copy real values into repository files.
- Do not print real values in logs.
- Do not include real values in exported Markdown.
- Mask values in diagnostics, showing only a short prefix/suffix if needed.
- If keys may have been exposed beyond the local environment, rotate them in the provider console.

## 7. Acceptance Criteria

- `.env.example` documents every required variable without real values.
- Real local env files are gitignored.
- App and runner validate missing env vars at startup.
- Logs mask secret values.
- Browserbase and Gemini keys are never exposed to client components.
