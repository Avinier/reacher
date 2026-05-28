# Official Documentation Links

> Parent plan: [plan.md](./plan.md)
> Last verified: 2026-05-27
> Scope: canonical official docs for Browserbase, Google ADK, Gemini, Vercel AI SDK, Drizzle, SQLite, and Next.js implementation

Use this file as the first stop for implementation research. Prefer these official sources over blog posts or generated examples.

## 1. Browserbase

### Core Browserbase

- [Browserbase docs home](https://docs.browserbase.com/)
- [Browserbase API reference](https://docs.browserbase.com/reference/api)
- [Browserbase integrations overview](https://docs.browserbase.com/integrations/get-started)

### Browser Agents and ADK

- [Browserbase browser agents solution](https://www.browserbase.com/solutions/browser-agents)
- [Browserbase agent use cases](https://docs.browserbase.com/use-cases/agents)
- [Browserbase Google ADK integration introduction](https://docs.browserbase.com/integrations/google-adk/introduction)
- [Browserbase Google ADK setup](https://docs.browserbase.com/integrations/google-adk/setup)

### Persistent Auth and Contexts

- [Browserbase contexts](https://docs.browserbase.com/features/contexts)
- [Browserbase website authentication guide](https://docs.browserbase.com/guides/authentication)

Implementation notes:

- Contexts are the Browserbase primitive for persisted login state.
- Reacher v1 should create one Browserbase context per platform: LinkedIn, X, Reddit, Discord.
- Sessions must use the relevant context with persistence enabled when the login state should be saved.
- Implementation must verify whether the Browserbase MCP path exposes every context/session option Reacher needs. If not, use the Browserbase SDK/API for session creation and MCP for browser actions where possible.

## 2. Google ADK

- [Google ADK docs home](https://adk.dev/)
- [ADK Python quickstart](https://adk.dev/get-started/python/)
- [ADK Gemini model docs](https://adk.dev/agents/models/google-gemini/)

Implementation notes:

- Reacher v1 uses a Python ADK runner.
- ADK is the long-running agent runtime, not the Next.js chat UI layer.
- The ADK runner should connect to Browserbase tools through the Browserbase MCP integration first.

## 3. Gemini

- [Gemini API docs home](https://ai.google.dev/docs)
- [Gemini API reference](https://ai.google.dev/gemini-api/docs/api-overview)
- [Using Gemini API keys](https://ai.google.dev/gemini-api/docs/api-key)
- [Gemini models](https://ai.google.dev/gemini-api/docs/models/gemini-v2)

Implementation notes:

- Local Gemini API key setup can use `GEMINI_API_KEY` or `GOOGLE_API_KEY`; Google's docs note `GOOGLE_API_KEY` takes precedence if both are set.
- The plan uses Gemini through two surfaces:
  - Python ADK runner for browser-agent work.
  - Vercel AI SDK Google provider for Next.js chat and lightweight generation.

## 4. Vercel AI SDK

- [AI SDK docs home](https://ai-sdk.dev/docs)
- [AI SDK getting started](https://ai-sdk.dev/docs/getting-started)
- [AI SDK providers overview](https://ai-sdk.dev/docs/providers)
- [AI SDK Google Generative AI provider](https://ai-sdk.dev/providers/ai-sdk-providers/google-generative-ai)

Implementation notes:

- Use `@ai-sdk/google` for Gemini calls from the Next.js app.
- Use AI SDK for chat streaming, lightweight intent parsing, summaries, and draft rewrites.
- Do not run long Browserbase jobs inside normal AI SDK route-handler request lifecycles.

## 5. Drizzle and SQLite

- [Drizzle SQLite get started](https://orm.drizzle.team/docs/get-started/sqlite-new)
- [Drizzle migrations](https://orm.drizzle.team/docs/migrations)
- [SQLite docs](https://www.sqlite.org/docs.html)
- [SQLite WAL mode](https://www.sqlite.org/wal.html)

Implementation notes:

- Drizzle owns migrations and the schema source of truth.
- Python runner database access must follow the Drizzle-generated schema.
- Local SQLite should use WAL mode and foreign keys.

## 6. Next.js

- [Next.js docs home](https://nextjs.org/docs)
- [Next.js App Router](https://nextjs.org/docs/app)
- [Next.js Route Handlers](https://nextjs.org/docs/app/building-your-application/routing/route-handlers)

Implementation notes:

- Next.js owns the local fullstack app shell.
- Route handlers can create runs and read state, but long-running ADK/Browserbase work belongs in the local Python runner.

## 7. Reddit Official API Exception

- [Reddit API overview](https://developers.reddit.com/docs/capabilities/server/reddit-api)
- [Reddit Data API Wiki](https://support.reddithelp.com/hc/en-us/articles/16160319875092-Reddit-Data-API-Wiki)
- [Reddit Data API Terms](https://redditinc.com/policies/data-api-terms)
- [Reddit Developer Terms](https://redditinc.com/policies/developer-terms)
- [Reddit API documentation](https://www.reddit.com/dev/api/)
- [Reddit User Actions](https://developers.reddit.com/docs/capabilities/server/userActions)
- [Devvit app configuration](https://developers.reddit.com/docs/capabilities/devvit-web/devvit_web_configuration)
- [Devvit CLI](https://developers.reddit.com/docs/guides/tools/devvit_cli)

Implementation notes:

- Reddit is the only v1 platform with an explicit API-assisted exception.
- Use official Reddit access only when browser-based Reddit login/research is blocked or developer-token-gated.
- Reddit write access should use Devvit-supported post/comment APIs where possible.
- Devvit apps do not require traditional Reddit client ID/client secret management; use `npx devvit login` and Devvit app configuration.
- User-account writes require `permissions.reddit.asUser` and Reddit approval for broad use.
- DMs, voting, moderation, and account-state changes remain out of scope unless separately planned.

## 8. Environment Variables To Plan For

```text
BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID
GOOGLE_API_KEY
GEMINI_API_KEY
GOOGLE_GENERATIVE_AI_API_KEY
GOOGLE_GEMINI_API_KEY
GOOGLE_AGENT_PLATFORM_API_KEY
DATABASE_URL
REACHER_SECRET_KEY
REDDIT_CLIENT_ID
REDDIT_CLIENT_SECRET
REDDIT_REDIRECT_URI
REDDIT_REFRESH_TOKEN
REDDIT_USER_AGENT
DEVVIT_SUBREDDIT
DEVVIT_APP_NAME
```

Current local Devvit values:

```text
DEVVIT_SUBREDDIT=reacher_usage_dev
DEVVIT_APP_NAME=reacher-usage
```

Recommended handling:

- Use `BROWSERBASE_API_KEY` and `BROWSERBASE_PROJECT_ID` for Browserbase.
- Use one Gemini key for local development, mirrored into the env names required by the selected libraries.
- If implementation uses the user-provided names `GOOGLE_GEMINI_API_KEY` or `GOOGLE_AGENT_PLATFORM_API_KEY`, map them at process startup to the names expected by ADK, Gemini SDKs, and Vercel AI SDK.
- Keep all secrets server-side or runner-side. Do not expose provider keys in client components.
- Commit only `.env.example`, never real `.env.local` values.
