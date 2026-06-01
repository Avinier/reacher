# X Research Skill

## When To Use
Use for X/Twitter profiles, search queries, posts, founder activity, developer complaints, hiring signals, and recent public conversations.

## Goals
Find accounts or threads with evidence strong enough to justify outreach. Prefer people who recently posted, replied, launched, complained, hired, asked for tools, or discussed a pain related to the run prompt.

## Page Cues
Home timeline indicates login. Search result pages, post detail pages, profile pages, reply sheets, protected accounts, suspended accounts, and login walls must be classified separately.

If Search/Fetch returns thin X markup, escalate to a Browserbase browser session using the persisted X context. Use the live Browserbase page for rendered text, visible profile metadata, recent posts, replies, and outbound links.

## Research Moves
Start with Browserbase Search queries:
- `site:x.com <prompt>`
- `site:twitter.com <prompt>`
- `<prompt> founder x.com`
- `<prompt> "building" "x.com"`
- `<prompt> "anyone using" OR "looking for" OR "recommend" "x.com"`

Fetch public search results first. Open a Browserbase X session only for pages where JavaScript rendering, login state, or visible thread context is required.

When in a logged-in browser session:
- Search X for exact pain terms from the prompt.
- Inspect top/latest posts and replies, not the home feed.
- Open profiles only after a post has useful evidence.
- Check bio, pinned post, recent posts, replies, and external website.
- Capture the post URL and profile URL before saving a target.
- Avoid likes, follows, DMs, reposts, or any write action during research.

## Extraction Targets
For each saved target, capture:
- Handle and display name.
- Profile URL and source post URL.
- Bio, website, company if visible.
- Recent post/reply text proving relevance.
- Date or recency cue if visible.
- Why this person/company fits the run prompt.
- Confidence score based on evidence quality.

## Action Recipes
Observe before opening multiple tabs or actions. Use one search-results tab and one profile/post tab when possible. Close irrelevant pages quickly.

For outreach draft prep, reference the specific public post or profile detail. Never imply access to private or non-visible information.

## Failure Cues
Protected account, suspended account, not found, stale search result, login-only page, rate-limit banner, challenge page, unavailable post, or content that cannot be linked as evidence.

## Stop Conditions
Stop if evidence cannot be captured with a stable source URL, if the account is private/protected, or if the only signal is weak keyword overlap.

## Output Requirements
Save targets with handle, display name, profile URL, source post URL, evidence quote, reason, score, and draftable outreach angle. Also save Browserbase session live/recording URLs when a browser session was used.
