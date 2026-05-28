# Reacher Reddit Devvit App

This app is the Reddit-specific exception to Reacher's browser-native platform model.

It uses Reddit's Devvit platform for API-backed Reddit access when Browserbase sessions are blocked by Reddit network security or developer-token gating.

Current Reddit app:

```text
name: reacher-usage
dev subreddit: reacher_usage_dev
uploaded version: v0.0.3
playtest version: v0.0.3.1
playtest URL: https://www.reddit.com/r/reacher_usage_dev/?playtest=reacher-usage
```

## Setup

```sh
cd /Users/avinier/ssai/reacher/apps/reddit-devvit
pnpm install
pnpm whoami
pnpm build
pnpm upload
pnpm dev
```

`pnpm whoami` should report the Reddit user authenticated through `npx devvit login`.

## Write Actions

The app requests:

```json
{
  "permissions": {
    "reddit": {
      "enable": true,
      "asUser": ["SUBMIT_POST", "SUBMIT_COMMENT"]
    }
  }
}
```

User-account post/comment writes require explicit operator action and Reddit approval for broad use. During playtest or unapproved app versions, Reddit may attribute `runAs: "USER"` actions differently, as described in the Devvit User Actions docs.

Private messages are app-account messages through `reddit.sendPrivateMessage`; they are not user-attributed Reddit DMs.

## Endpoints

- `GET /api/health`
- `GET /api/posts`
- `POST /api/submit-post`
- `POST /api/submit-comment`
- `POST /api/send-private-message`
- `GET /`

These endpoints are intended for the Devvit runtime. A later Reacher integration packet should define how the local Reacher app routes approved Reddit write actions through this Devvit app.
