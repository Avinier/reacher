# Browserbase Contexts Plan

> Parent plan: [plan.md](./plan.md)
> Scope: persistent logged-in browser identity, context onboarding, session reuse, and recovery

## 1. Outcome

Reacher must let the user connect one persistent Browserbase context per platform, manually log in once, verify the account is usable, and reuse that logged-in browser state for research and outreach preparation runs.

Platforms in v1:

- LinkedIn
- X
- Reddit
- Discord

Telegram is out of scope.

## 2. Ownership

| Component | Responsibility |
|---|---|
| `apps/web` | Context onboarding UI, status display, relogin controls, run-time context selection. |
| `apps/runner` | Start Browserbase sessions with the requested context, verify login state, close sessions correctly. |
| SQLite | Store platform context records, status, last verification, and provider IDs. |
| Browserbase | Persist browser state and run browser sessions. |

## 3. Required Files or Artifacts

Future implementation should create:

```text
apps/web/app/contexts/page.tsx
apps/web/app/contexts/[platform]/page.tsx
apps/web/lib/browser-contexts.ts
apps/web/db/schema/browser-contexts.ts
apps/runner/reacher_runner/browserbase/driver.py
apps/runner/reacher_runner/browserbase/context_verifier.py
packages/shared/browser-context-contracts.ts
```

## 4. Context Model

Each platform has exactly one primary context in v1.

```text
browser_contexts
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

Status meaning:

| Status | Meaning |
|---|---|
| `needs_login` | Context exists or is requested, but the user has not completed login. |
| `ready` | Verification passed recently. |
| `expired` | Verification detected logout, challenge, or unavailable session. |
| `locked` | User intentionally disabled this context. |
| `error` | Browserbase or runner failed before verification could complete. |

Additional implementation note:

- A platform can reject the Browserbase session before login because of network or browser-risk checks. Reddit has already shown a "blocked by network security" failure during manual login. Treat this as a context status problem, not an application crash.

## 5. Onboarding Flow

### 5.1 Create Context

Required behavior:

- User selects platform.
- App creates or registers a Browserbase context.
- App opens a live browser session tied to that context.
- User manually logs in.
- User clicks "Verify" in Reacher.

Rules:

- Never ask the user to paste social account passwords into Reacher.
- Login happens inside the Browserbase live session.
- Store provider context IDs server-side only.

### 5.2 Verify Context

Verification should be browser-based and platform-specific.

Examples:

| Platform | Verification target | Pass condition |
|---|---|---|
| LinkedIn | `https://www.linkedin.com/feed/` | Feed or profile nav is visible and login page is absent. |
| X | `https://x.com/home` | Home timeline or account nav is visible and login page is absent. |
| Reddit | `https://www.reddit.com/` | User account menu or logged-in shell is visible. |
| Discord | `https://discord.com/channels/@me` | Direct messages or server shell is visible. |

Verification output:

```json
{
  "status": "ready",
  "account_label": "visible account name or handle when extractable",
  "evidence": {
    "url": "https://x.com/home",
    "screenshot_artifact_id": "artifact_..."
  }
}
```

### 5.2.1 Blocked or Challenged Contexts

Required behavior:

- If a platform blocks login because of network security, mark the context `expired` or `error` with a clear `last_error`.
- Keep the context record so the user can retry later.
- Do not mark the platform ready.
- Allow unauthenticated/public research for that platform where possible.

Platform-specific mitigation options to evaluate during implementation:

- Browserbase geolocated proxy settings for a consistent region.
- Verified browser mode if supported by the current Browserbase plan.
- Starting with public Browserbase Search/Fetch for Reddit instead of authenticated browser sessions.
- Optional local-browser fallback for login-sensitive platforms in a later milestone.

Rules:

- Do not add CAPTCHA bypass or stealth-evasion systems as a v1 requirement.
- Do not block all Reacher workflows because one platform context is not ready.

### 5.3 Relogin

Required behavior:

- If a run detects logout or challenge, set context status to `expired`.
- UI shows "Relogin" for that platform.
- User opens live session, logs in again, and verifies.

Rules:

- Do not silently switch to another platform context.
- Do not delete an expired context automatically.

## 6. Session Creation

When a run needs a platform:

```text
load browser_context by platform
if status != ready:
  fail run step with "context requires login"
start Browserbase session using provider_context_id
persist session metadata
run browser task
close session and persist context state when appropriate
```

Implementation must verify the exact Browserbase MCP or SDK mechanism for binding sessions to contexts. If MCP cannot express all required context options, the runner should create sessions through Browserbase SDK/API and then expose the connected session to MCP-compatible tools when possible.

## 7. Security and Local Secret Handling

Required environment variables:

```text
BROWSERBASE_API_KEY
BROWSERBASE_PROJECT_ID
GOOGLE_API_KEY
```

Rules:

- `.env.local` stays local and is not committed.
- Browserbase context IDs are not the same as API keys, but still should not be exposed in client components.
- Client UI should call Next.js server routes for context operations.

## 8. Acceptance Criteria

- User can create and verify one context per platform.
- Context records persist in SQLite.
- A runner smoke test can start a Browserbase session for a selected context.
- Verification failure updates the context status with a useful error.
- Platform-side network-security blocks are stored as actionable context errors.
- Context pages show last verified time and account label when available.
- A disabled or expired context cannot be selected for a run without relogin.

## 9. Out of Scope

- Multiple accounts per platform.
- Team-shared contexts.
- Password management.
- CAPTCHA/challenge solving.
- Proxy or location management.
- Telegram sessions.
