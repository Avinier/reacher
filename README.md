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

Copy `.env.example` to `.env.local` or use the existing local `.env`. Real secrets must stay out of source files.
