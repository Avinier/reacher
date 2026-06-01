# Reacher

Reacher is a local-first browser-agent workbench. It uses a Next.js fullstack app, SQLite/Drizzle-owned schema, a local Python runner, Browserbase browser contexts, Gemini, and editable browser skills.

## Local Setup

```sh
pnpm install
pnpm db:generate
pnpm db:migrate
pnpm --filter web dev
```

The runner can be checked with:

```sh
cd apps/runner
uv run python -m reacher_runner.main --once
uv run pytest
```

## Browserbase Deep Research

Research runs use Reddit's public JSON API for Reddit, and Browserbase for all other selected platforms when `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` are configured.

The runner follows the Browserbase agent pattern:

1. Browserbase Search discovers candidate URLs without starting a browser.
2. Browserbase Fetch extracts lightweight page evidence.
3. Browserbase browser sessions are opened for logged-in platforms with ready contexts, currently LinkedIn, X, and Discord.

Use `/contexts` in the web app to create and verify one persistent Browserbase context per logged-in platform. X/Twitter research uses `apps/runner/skills/x/research.md` to search `x.com`/`twitter.com`, inspect rendered profiles/posts through the Browserbase X context when needed, and save evidence-backed targets only.

YC Winter 2022 batch prompts are handled by a dedicated Browserbase rendered-browser flow. It opens the YC startup directory, collects the first 30 Winter 2022 company profiles, stores company socials, searches founder/social clues, uses Gemini Flash for concise notes when available, and exports the list like any other research run.

Run detail pages and exports include per-run usage accounting. Browserbase usage records Search calls, Fetch calls, and browser-session seconds with estimated overage-rate costs. Gemini usage records provider token metadata when available; Gemini CLI calls record estimated input/output tokens and pay-as-you-go equivalent cost because the CLI does not expose billable token telemetry.

Copy `.env.example` to `.env.local` or use the existing local `.env`. Real secrets must stay out of source files.
