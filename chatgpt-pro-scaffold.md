Below is the plan I would build if this were my product: **local-first, browser-capable, containerized, research-heavy, with a clean CRM/dashboard layer, and with supervised sending instead of risky blind mass-DM automation**.

## 1. The core verdict

Build this as an **agentic outreach operating system**, not as one giant “sentient agent.” The winning architecture is:

**Next.js dashboard + Postgres CRM + durable agent worker + Playwright/Stagehand browser layer + Browserbase-ready browser abstraction + Cal.com integration + strict human approval for risky actions.**

My recommended stack:

| Layer                | Recommendation                                          | Why                                                                                                                                                                                                                                                           |
| -------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dashboard            | **Next.js + Tailwind + shadcn/ui + TanStack Table**     | Fast, sleek, easy to build CRM-style views.                                                                                                                                                                                                                   |
| Backend API          | **FastAPI or NestJS**                                   | FastAPI if you want Python-heavy agents; NestJS if you want all-TypeScript.                                                                                                                                                                                   |
| Agent workflow       | **LangGraph + provider SDKs**                           | Best fit for long-running, resumable, human-in-the-loop workflows. LangGraph explicitly supports durable execution and resuming after failures or human pauses. ([LangChain Docs][1])                                                                         |
| Browser automation   | **Playwright + Stagehand**                              | Playwright is the deterministic browser engine; Stagehand adds `act`, `extract`, `observe`, and agentic browser primitives without making everything brittle. ([Playwright][2])                                                                               |
| Future cloud browser | **Browserbase**                                         | Start local, then swap browser provider to Browserbase for managed sessions, session replay, and cloud execution. Browserbase supports direct session control with common automation frameworks and cloud browser functions. ([Browserbase Documentation][3]) |
| Queue / durable jobs | **BullMQ for MVP, Temporal for serious production**     | BullMQ is simple local Redis-backed jobs; Temporal is better when workflows must survive failures, pauses, and long runs. ([BullMQ][4])                                                                                                                       |
| Data store           | **Postgres + pgvector + object storage**                | Relational CRM data, embeddings for lead memory, screenshots/HTML/exports stored separately.                                                                                                                                                                  |
| Research APIs        | **Exa/Tavily/Firecrawl/Apify as optional accelerators** | Browser should not do everything. Use search/extraction APIs for public web research, then browser for dynamic pages. Exa, Firecrawl, Apify, and People Data Labs all have useful research/enrichment primitives. ([Exa][5])                                  |
| Calendar             | **Cal.com API v2 + webhooks**                           | Cal.com supports API v2 bookings and webhooks for scheduled/cancelled/rescheduled meeting events. ([Cal][6])                                                                                                                                                  |

The important product decision: **make the agent fully autonomous for research and drafting, but supervised for sending messages on restricted platforms**.

That is not just legal caution. It is also product reliability. LinkedIn explicitly prohibits bots/unauthorized automation for scraping, adding/downloading contacts, and sending messages. ([LinkedIn][7]) X requires explicit consent before automated replies or DMs and prohibits bulk/aggressive/spammy actions. ([X Developer Platform][8]) Reddit requires explicit consent for private communications and bans spammy automated posts/comments/DMs. ([Reddit Help][9]) Discord forbids automating normal user accounts outside the bot/OAuth API. ([Discord Support][10])

So the best version is: **research → enrich → score → draft → personalize → queue → human approve/send or permitted API send → log → attribute meetings**.

---

## 2. What the system should actually do

Think of the app as four systems glued together.

### A. Research engine

The agent takes a prompt like:

> “Give me all companies from the YC 2025 batches.”

It turns that into a structured research job:

```json
{
  "goal": "Find companies from YC 2025 batches",
  "sources": ["Y Combinator company directory", "company websites", "public social links"],
  "constraints": {
    "include_only_if_has_contact_or_social_link": true,
    "batches": ["Winter 2025", "Spring 2025", "Summer 2025", "Fall 2025"],
    "required_fields": ["company_name", "batch", "website", "at_least_one_social_or_contact_link"]
  }
}
```

The YC Startup Directory is a real official source and supports batch-filtered pages, so this use case is a perfect MVP target. ([Y Combinator][11])

The output should not just be a list. Every row should have provenance:

```ts
type CompanyLead = {
  companyName: string;
  ycBatch: string;
  ycUrl: string;
  websiteUrl?: string;
  oneLiner?: string;
  location?: string;
  founders?: PersonLead[];
  communicationLinks: ContactPoint[];
  sourceEvidence: SourceEvidence[];
  confidence: number;
  eligibility: "eligible" | "rejected_no_contact_link" | "needs_review";
};
```

Your rule should be enforced at the database level:

> A company/person is only campaign-eligible when at least one valid communication link exists.

Communication link can mean: company contact page, founder X profile, founder LinkedIn URL, GitHub, Discord community invite, public email, Cal link, or a permitted platform profile URL.

### B. CRM/list engine

The dashboard lets you save research outputs into lists:

* “YC 2025 all companies”
* “YC W25 devtools”
* “YC S25 founders with Twitter”
* “Healthcare AI founders”
* “Discord communities to monitor”

Each list has:

* Companies
* People/founders
* Contact points
* Source links
* Confidence score
* Outreach status
* Message history
* Meeting attribution
* Notes
* Tags
* Suppression/opt-out state

You can export any list to Markdown:

```md
# YC 2025 Companies

Generated: 2026-05-27  
Eligibility rule: included only if at least one social/contact link was found.

| Company | Batch | Website | Social / Contact Links | Founders | Confidence | Sources |
|---|---|---|---|---|---|---|
| ExampleCo | W25 | example.com | X, LinkedIn, Contact page | Jane Doe | 0.92 | YC, website |
```

### C. Drafting/personalization engine

The agent should not hallucinate personalization. It should only personalize from saved facts.

Example message variables:

```ts
type MessageVariables = {
  firstName?: string;
  companyName: string;
  observedFact?: string;
  painHypothesis?: string;
  sourceUrl?: string;
  calLink?: string;
};
```

Message variant:

```ts
type MessageVariant = {
  id: string;
  campaignId: string;
  name: "short_direct" | "curious_question" | "founder_to_founder";
  channel: "linkedin" | "x" | "reddit" | "discord" | "email";
  bodyTemplate: string;
  maxLength?: number;
  weight: number;
};
```

Round-robin assignment should be deterministic:

```ts
variant = activeVariants[hash(campaignId + leadId) % activeVariants.length]
```

That prevents the same lead from getting different variants if the run is retried.

### D. Outreach/action engine

This is where I would be strict.

The agent should have three action modes:

| Mode                 | What happens                                                                                                | Use it for                                                                         |
| -------------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| **Research mode**    | Fully autonomous browsing/extraction.                                                                       | YC/company research, public pages, website extraction.                             |
| **Draft mode**       | Fully autonomous drafting, but no sending.                                                                  | Message generation, personalization, variants.                                     |
| **Send-assist mode** | Opens profile, shows draft, maybe copies text; user performs final send or uses approved API where allowed. | LinkedIn/X/Reddit/Discord cold outreach.                                           |
| **Auto-send mode**   | Only through approved APIs or consent-based channels.                                                       | Email with compliance, opted-in X DMs, your own Discord bot/server, Cal workflows. |

For LinkedIn specifically, I would **not** build autonomous browser DM sending. The product should open the lead/profile, show the approved draft, and let you send manually or mark as sent. LinkedIn’s agreement explicitly prohibits software/scripts/robots for scraping and bots/unauthorized automation for sending or redirecting messages. ([LinkedIn][7])

For Discord, do not use a self-bot. Use a proper Discord bot in servers where you have permission. Discord states that automating normal user accounts outside the bot/OAuth API is forbidden and can lead to account termination. ([Discord Support][10])

---

## 3. Tool comparison

### Agent SDKs/frameworks

| Tool                                    |                             Use it? | Notes                                                                                                                                                                                                                                            |
| --------------------------------------- | ----------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **LangGraph**                           |     **Yes, primary workflow layer** | Best fit for durable, resumable, human-in-the-loop campaigns. It explicitly supports saving progress, pausing, and resuming after failures or human review. ([LangChain Docs][1])                                                                |
| **OpenAI Agents SDK**                   |      Good alternative / model layer | Strong if you want OpenAI-native orchestration, tools, guardrails, human review, tracing, and custom storage. OpenAI’s docs position it for applications that own orchestration, tool execution, approvals, and state. ([OpenAI Developers][12]) |
| **Claude Agent SDK**                    | Useful, but not my core choice here | It is excellent for code/file/command/web-search agents and is essentially Claude Code as a programmable library. For browser-heavy outreach CRM, you still need Playwright/Stagehand and your own state layer. ([Claude Code][13])              |
| **Google ADK**                          |       Good if you want Gemini-first | Google ADK is open-source and available in Python, TypeScript, Go, Java, and Kotlin. It pairs naturally with Gemini and Google Search tooling. ([adk.dev][14])                                                                                   |
| **Google Gemini Computer Use**          |    Use as optional browser fallback | Good for visual UI tasks, but Google labels Computer Use as preview and recommends close supervision for important tasks. ([Google AI for Developers][15])                                                                                       |
| **OpenAI Computer Use**                 |      Optional for hard UI workflows | Useful for screenshot/action-based UI automation. OpenAI recommends isolated browser/VM environments, human-in-the-loop for high-impact actions, and treating page content as untrusted. ([OpenAI Developers][16])                               |
| **CrewAI**                              |                 Not my first choice | Great for role-playing multi-agent demos, less ideal for precise CRM state machines and approval workflows.                                                                                                                                      |
| **Mastra**                              |     Good if you want all-TypeScript | Attractive for a Next.js/TypeScript product, but I would still design explicit workflow state and approvals.                                                                                                                                     |
| **Microsoft Agent Framework / AutoGen** |         Skip unless Microsoft-heavy | More enterprise-stack oriented; unnecessary for this MVP.                                                                                                                                                                                        |

My pick: **LangGraph + Stagehand + Playwright + provider-agnostic model router**.

Use OpenAI/Claude/Gemini as interchangeable model providers rather than locking the entire system to one agent SDK.

---

## 4. Browser layer design

You want the agent to “live in the browser,” but the browser layer should be split into **deterministic automation** and **agentic fallback**.

### Browser execution stack

```txt
Agent planner
  ↓
Browser task router
  ↓
1. Playwright deterministic scripts
2. Stagehand act/extract/observe
3. Computer-use model fallback for hard visual UI
  ↓
Browser session manager
  ↓
Local Chromium now / Browserbase later
```

Use deterministic code whenever the target flow is known:

* Navigate to YC directory
* Scroll/load more
* Extract cards
* Visit company website
* Extract social links
* Save HTML/screenshot

Use Stagehand when selectors are brittle but the intent is simple:

* “Extract company name, batch, website, one-liner”
* “Find all social links on this page”
* “Click the company website link”
* “Observe available profile/contact links”

Use computer-use models only for messy UI tasks. They are more expensive, less predictable, and require stronger safety controls.

### Browser safety rules

Every browser session should have:

* Isolated browser context
* Per-platform allowed domain list
* No host environment variables
* No local filesystem access unless explicitly mounted
* No extension access by default
* Screenshot/HTML/action log
* Human approval for message sending, purchasing, account changes, following, connecting, posting, or joining communities

That matches the safety direction in OpenAI’s computer-use documentation: run in an isolated environment, decide allowed sites/actions upfront, keep humans in the loop for high-impact actions, and treat web page content as untrusted. ([OpenAI Developers][16])

---

## 5. The local-first architecture

Run it locally on your Mac with Docker Compose, but keep the browser provider swappable.

```txt
apps/
  web/                 Next.js dashboard
  api/                 FastAPI or NestJS API
  worker/              Agent worker: LangGraph + browser tools
  browser/             Playwright/Stagehand harness
  shared/              Schemas, prompts, types

infra/
  docker-compose.yml
  postgres/
  redis/
  temporal/            optional, production-grade workflows
  minio/               optional local object storage
```

Local containers:

| Container  | Purpose                                           |
| ---------- | ------------------------------------------------- |
| `web`      | Dashboard UI                                      |
| `api`      | Auth, CRUD, campaign endpoints, WebSocket updates |
| `worker`   | Agent runs, extraction, scoring, drafting         |
| `postgres` | CRM, leads, campaigns, agent state                |
| `redis`    | Queue, locks, live run status                     |
| `browser`  | Playwright Chromium with optional noVNC live view |
| `temporal` | Optional durable workflow engine                  |
| `minio`    | Optional screenshots, HTML snapshots, exports     |

One practical Mac detail: **visible browsers inside Docker on macOS are awkward**. For the earliest MVP, either run Playwright on the host machine or run Chromium in a container with noVNC. Keep the interface abstract:

```ts
interface BrowserProvider {
  createSession(input: BrowserSessionInput): Promise<BrowserSession>;
  connect(sessionId: string): Promise<BrowserHandle>;
  close(sessionId: string): Promise<void>;
}
```

Implementations:

```txt
LocalPlaywrightProvider
DockerNoVncProvider
BrowserbaseProvider
```

That gives you local development now and cloud/browser sandboxing later.

---

## 6. Database schema

Minimum tables:

```txt
users
workspaces
integrations
browser_profiles
research_sessions
agent_runs
agent_steps
source_documents
companies
people
contact_points
lead_lists
lead_list_members
campaigns
message_variants
message_drafts
outreach_attempts
conversation_events
calendar_events
approvals
audit_events
suppression_list
exports
```

Key tables:

### `companies`

```sql
id
workspace_id
name
normalized_name
website_url
yc_url
yc_batch
one_liner
description
location
confidence
created_at
updated_at
```

### `people`

```sql
id
workspace_id
company_id
full_name
first_name
last_name
title
role
profile_summary
confidence
created_at
updated_at
```

### `contact_points`

```sql
id
workspace_id
owner_type            -- company | person
owner_id
channel               -- linkedin | x | reddit | discord | email | website | github | contact_form
url
handle
is_primary
is_verified
source_document_id
consent_status         -- unknown | opted_in | opted_out | do_not_contact
created_at
updated_at
```

### `outreach_attempts`

```sql
id
workspace_id
campaign_id
company_id
person_id
contact_point_id
channel
message_variant_id
message_draft_id
status                 -- queued | needs_approval | approved | opened | sent_by_user | api_sent | replied | meeting_booked | failed | skipped
sent_at
reply_at
meeting_at
operator_user_id
browser_session_id
proof_screenshot_id
notes
created_at
updated_at
```

### `approvals`

```sql
id
workspace_id
agent_run_id
action_type            -- send_message | post_reply | connect | follow | join_server | book_meeting
risk_level             -- low | medium | high
payload_json
status                 -- pending | approved | denied | expired
approved_by
created_at
updated_at
```

This schema gives you the exact dashboard you described: who you found, where you messaged them, what draft was used, what channel, what happened next, and whether a meeting was booked.

---

## 7. YC 2025 workflow in detail

User prompt:

> “Give me all companies from the YC 2025 batches.”

Agent plan:

```txt
1. Resolve “YC 2025 batches” into batch filters.
2. Browse official YC company directory.
3. Extract company cards.
4. Visit each company page.
5. Visit company website.
6. Extract social/contact links.
7. Extract founders if public on YC/company site.
8. Validate: keep only companies with at least one contact/social link.
9. Deduplicate by YC slug, domain, and normalized name.
10. Save to a lead list.
11. Generate Markdown and dashboard table.
```

Extraction schema:

```ts
const CompanyExtractionSchema = z.object({
  companyName: z.string(),
  ycBatch: z.string(),
  ycUrl: z.string().url(),
  websiteUrl: z.string().url().optional(),
  oneLiner: z.string().optional(),
  founders: z.array(z.object({
    name: z.string(),
    title: z.string().optional(),
    socialLinks: z.array(z.object({
      channel: z.enum(["linkedin", "x", "github", "website", "email", "discord", "reddit"]),
      url: z.string()
    }))
  })).default([]),
  companySocialLinks: z.array(z.object({
    channel: z.enum(["linkedin", "x", "github", "website", "email", "discord", "reddit", "contact_form"]),
    url: z.string()
  })),
  evidence: z.array(z.object({
    url: z.string(),
    quoteOrSelector: z.string().optional(),
    capturedAt: z.string()
  }))
});
```

Eligibility rule:

```ts
function isEligible(company: CompanyExtraction): boolean {
  const links = [
    ...company.companySocialLinks,
    ...company.founders.flatMap(f => f.socialLinks),
  ];

  return links.length > 0;
}
```

Dashboard output:

| Column           | Meaning                                            |
| ---------------- | -------------------------------------------------- |
| Company          | Company name                                       |
| Batch            | YC batch                                           |
| Website          | Company domain                                     |
| Contact coverage | LinkedIn/X/GitHub/contact/email/etc.               |
| Founders         | Founder names + available public profiles          |
| Confidence       | Extraction confidence                              |
| Status           | New / reviewed / drafted / sent / replied / booked |
| Sources          | YC page, company website, other public source      |

Markdown export button:

```txt
Export → Markdown
Export → CSV
Export → JSON
```

---

## 8. Outreach by platform

### LinkedIn

Recommended:

* Research company/founder names and public URLs.
* Generate draft.
* Open LinkedIn URL in controlled browser.
* Show draft in side panel.
* User manually sends or marks as sent.

Do **not** build autonomous bot sending on LinkedIn. LinkedIn’s User Agreement prohibits scraping/copying services with software/scripts/robots and unauthorized automated methods for sending messages, adding/downloading contacts, posts, comments, likes, and similar actions. ([LinkedIn][7])

### X/Twitter

Recommended:

* Use X API only for permitted use cases.
* For DMs, require explicit consent before automated messages.
* For cold outreach, keep it as draft/open/manual-send.

X’s developer policy says services performing write actions, including Direct Messages, must follow automation rules; it specifically says to get explicit consent before automated replies or DMs, respect opt-outs, and never perform bulk/aggressive/spammy actions. ([X Developer Platform][8])

### Reddit

Recommended:

* Use official Reddit API/app registration where possible.
* No automated cold DMs.
* Use the agent for subreddit research, discussion summarization, and draft replies.
* Require human approval before posting/commenting.
* Respect subreddit rules.

Reddit’s Responsible Builder Policy says apps must register, must get explicit consent for private communications, and must not engage in spamming activity through automated posts, comments, or DMs. ([Reddit Help][9])

### Discord

Recommended:

* Use a proper Discord bot account.
* Only operate in servers/channels where you have permission.
* Do not automate your normal user account.
* Use the agent to monitor channels, summarize opportunities, draft replies, and ask you for approval.

Discord explicitly says normal user-account automation, or “self-bots,” outside the OAuth2/bot API is forbidden. ([Discord Support][10])

### Email

Email is often the most automation-friendly channel if you handle compliance properly:

* Include opt-out.
* Track bounces.
* Respect unsubscribes.
* Avoid deceptive identity.
* Use domain warmup/reputation best practices, but do not spam.
* Store suppression list globally.

This can be your only true “auto-send” cold channel, depending on jurisdiction and compliance.

---

## 9. Dashboard pages

### 1. Command Center

A simple prompt box:

```txt
Research: “Find all YC 2025 companies building AI sales tools”
```

Shows live agent runs:

* Current browser URL
* Current step
* Extracted rows
* Errors
* Cost estimate
* Approval requests
* Stop/pause/resume buttons

### 2. Research Sessions

Each session shows:

* Prompt
* Sources searched
* Rows found
* Rows rejected
* Rows needing review
* Screenshots/HTML evidence
* Export button

### 3. Lead Lists

CRM-style table:

* Company
* People
* Channel coverage
* Score
* Last touch
* Next action
* Meeting status
* Owner
* Tags

### 4. Lead Detail

One page per company/person:

* Company summary
* Founder/person summary
* All contact points
* Source evidence
* Drafts
* Outreach timeline
* Calendar events
* Notes
* Suppression/opt-out controls

### 5. Campaign Builder

Define:

* List
* Channel priority
* Message variants
* Personalization rules
* Approval rules
* Daily action budget
* Cal link
* Stop conditions

Example stop conditions:

```txt
Stop if replied.
Stop if booked meeting.
Stop if opted out.
Stop if no verified contact point.
Stop if confidence < 0.75.
```

### 6. Draft Review Queue

Inbox-style page:

```txt
[Lead] [Channel] [Draft] [Evidence] [Approve] [Edit] [Skip]
```

Every draft should show the personalization evidence. Example:

```txt
Personalized line: “Saw you’re building infra for clinical workflows.”
Evidence: company website homepage, captured 2026-05-27.
```

### 7. Browser Control Room

Live browser/session viewer:

* Active session
* Screenshot stream
* Current URL
* Last actions
* Manual takeover button
* “Copy draft” button
* “Mark sent” button
* “Block this domain/action” button

### 8. Analytics

Metrics:

* Leads found
* Eligible lead rate
* Contact coverage by channel
* Draft approval rate
* Sent/manual-sent count
* Reply rate
* Meeting booked rate
* Channel performance
* Variant performance
* Source accuracy
* Cost per qualified lead
* Cost per meeting
* Agent failure rate

---

## 10. Cal.com integration

Use Cal.com for the meeting layer.

Implementation:

1. Create one Cal link per campaign or per lead.
2. Add tracking fields:

   * `campaign_id`
   * `lead_id`
   * `channel`
   * `variant_id`
3. Register Cal.com webhooks for:

   * booking created
   * booking rescheduled
   * booking cancelled
   * meeting started/ended if useful
4. On webhook, match booking back to lead/campaign and update the outreach timeline.

Cal.com’s docs describe API v2 booking creation via `POST /v2/bookings`, and their webhook system can notify your app when invitees schedule, cancel, reschedule, or when meetings start/end. ([Cal][6])

---

## 11. Agent design

Use multiple specialist agents, but keep them under one deterministic workflow.

```txt
Campaign Planner
  ↓
Research Agent
  ↓
Extraction Agent
  ↓
Verifier Agent
  ↓
Enrichment Agent
  ↓
Scoring Agent
  ↓
Drafting Agent
  ↓
Approval Agent
  ↓
Channel Action Agent
  ↓
Analytics/Attribution Agent
```

### Research Agent

Responsibilities:

* Turn prompt into source plan.
* Search web.
* Visit official directories.
* Collect candidate URLs.
* Avoid logged-in/private scraping unless explicitly allowed.

### Extraction Agent

Responsibilities:

* Extract structured company/person/contact data.
* Save provenance.
* Reject rows without required fields.
* Never fabricate missing socials.

### Verifier Agent

Responsibilities:

* Check social/contact links actually resolve.
* Check company identity matches.
* Deduplicate.
* Assign confidence.

### Drafting Agent

Responsibilities:

* Generate variants.
* Personalize from evidence only.
* Fit channel constraints.
* Add CTA/Cal link.
* Flag weak personalization.

### Channel Action Agent

Responsibilities:

* For restricted platforms: open page + present draft + wait for user.
* For approved APIs/consented channels: send through API.
* Log proof/status.

---

## 12. Prompt and policy guardrails

Add hard system rules to the agent:

```txt
You may research public webpages and extract structured data with citations.
You may not fabricate contact links.
You may not send messages, connection requests, comments, posts, follows, or joins without explicit approval.
You may not bypass rate limits, CAPTCHAs, login protections, or platform access controls.
You must stop if a page requests no automated access or if the platform policy disallows the intended action.
You must record provenance for every extracted field.
You must respect opt-outs and suppression lists.
```

For browser actions:

```txt
Allowed autonomous actions:
- open public pages
- scroll
- click public links
- extract page content
- save screenshots
- fill internal app forms

Approval-required actions:
- send message
- post comment
- connect/follow
- join server/community
- submit external form
- book/cancel/reschedule meeting
- change account settings
```

---

## 13. Files and exports

Every research session should create:

```txt
exports/
  yc-2025-companies.md
  yc-2025-companies.csv
  yc-2025-companies.json
artifacts/
  screenshots/
  html_snapshots/
  run_logs/
```

Markdown export format:

```md
# YC 2025 Companies

Generated: 2026-05-27  
Prompt: give me all companies from the yc 2025 batches  
Rule: included only if at least one social/contact link was found.

## Summary

- Total candidates found: 000
- Eligible companies: 000
- Rejected due to no contact/social link: 000
- Needs review: 000

## Companies

### Company Name

- Batch: W25
- Website: https://example.com
- YC URL: https://www.ycombinator.com/companies/example
- One-liner: ...
- Founders:
  - Jane Doe — LinkedIn, X
- Contact links:
  - Website contact page
  - X
  - LinkedIn
- Confidence: 0.91
- Sources:
  - YC page
  - Company website
```

---

## 14. Build milestones

### Phase 1: Local CRM + research MVP

Build:

* Next.js dashboard
* Postgres schema
* Research session page
* Agent worker
* YC directory workflow
* Stagehand/Playwright extraction
* Lead list save
* Markdown/CSV export

Success criterion:

> You can type “YC 2025 companies,” get a reviewed table, and export Markdown.

### Phase 2: Enrichment + verification

Build:

* Company website crawler
* Social/contact extractor
* Link verifier
* Deduplication
* Confidence scoring
* Evidence viewer
* Rejection reasons

Success criterion:

> Every eligible company has at least one verified contact/social link and evidence.

### Phase 3: Drafting engine

Build:

* Campaign builder
* Message variants
* Personalization rules
* Draft queue
* Evidence-backed personalization
* Variant assignment
* Edit/approve/skip flow

Success criterion:

> The system can generate high-quality personalized drafts without sending anything.

### Phase 4: Send-assist workflows

Build:

* Browser profile manager
* Open profile from dashboard
* Show draft beside browser
* Copy draft
* Mark sent
* Save screenshot/proof
* Outreach timeline

Success criterion:

> You can process outreach quickly while staying in control of final sends.

### Phase 5: Cal.com attribution

Build:

* Cal.com integration
* Per-campaign/lead tracking links
* Webhook endpoint
* Meeting attribution
* Analytics dashboard

Success criterion:

> Meetings booked from outreach update the lead and campaign automatically.

### Phase 6: Discord/community workflows

Build:

* Discord bot integration for permitted servers
* Channel monitoring
* Thread summarization
* Reply draft queue
* Human approval for replies
* Community/contact tagging

Success criterion:

> The agent can help you participate in relevant communities without self-botting or spamming.

### Phase 7: Cloud-ready sandbox

Build:

* BrowserProvider abstraction
* Browserbase provider
* Session replay links
* Worker autoscaling
* Temporal workflows if not already added
* Secrets manager
* Audit logs

Success criterion:

> The same agent that runs locally can run in a cloud sandbox with minimal code changes.

---

## 15. The exact stack I would choose

For your first serious version:

```txt
Frontend:
  Next.js
  Tailwind
  shadcn/ui
  TanStack Table
  React Flow for workflow visualization

Backend:
  FastAPI
  Pydantic
  SQLAlchemy or SQLModel
  Postgres
  Redis
  BullMQ or Python RQ for MVP queue

Agent:
  LangGraph
  OpenAI / Anthropic / Gemini provider adapters
  Stagehand
  Playwright
  Firecrawl / Exa / Tavily optional

Browser:
  Local Playwright persistent contexts first
  Docker noVNC browser for controlled sessions
  Browserbase provider later

Storage:
  Postgres for records
  S3/MinIO for screenshots, HTML, exports

Calendar:
  Cal.com API v2 + webhooks

Observability:
  Agent run logs
  Browser screenshots
  Tool-call traces
  OpenTelemetry later
```

The only reason to choose an all-TypeScript stack instead would be developer preference. In that case:

```txt
Next.js + NestJS + Prisma + Postgres + BullMQ + Stagehand TS + OpenAI/Claude/Gemini SDKs
```

That is also a very strong path.

---

## 16. What I would not build

I would not build:

* A hidden LinkedIn/X/Reddit/Discord mass-DM bot.
* CAPTCHA/proxy/stealth logic to bypass platform enforcement.
* A self-bot for Discord.
* A system that sends messages without approval/provenance.
* A scraper that stores private content without permission.
* A “sentient” black box with no run logs.

Those choices create account bans, bad data, poor deliverability, and legal/platform risk.

---

## 17. The best MVP target

Start with exactly this:

> “Research YC 2025 companies, include only companies with at least one public contact/social link, save them to a list, export Markdown, generate outreach drafts, and let me manually send/log messages from a dashboard.”

That MVP proves the hard parts:

* Browser research
* Structured extraction
* Data validation
* CRM/list state
* Draft generation
* Human approval
* Channel tracking
* Cal attribution

Once that works, adding more sources and channels becomes an engineering problem, not a product-risk problem.

[1]: https://docs.langchain.com/oss/python/langgraph/durable-execution "Durable execution - Docs by LangChain"
[2]: https://playwright.dev/?utm_source=chatgpt.com "Fast and reliable end-to-end testing for modern web apps | Playwright"
[3]: https://docs.browserbase.com/welcome/getting-started?utm_source=chatgpt.com "Overview - Browserbase Documentation"
[4]: https://bullmq.io/?utm_source=chatgpt.com "BullMQ - Background Jobs and Message Queue for Node.js, Python, Elixir ..."
[5]: https://docs.exa.ai/?utm_source=chatgpt.com "Exa Search API - Exa"
[6]: https://cal.com/docs/api-reference/v2/bookings/create-a-booking?utm_source=chatgpt.com "Create a booking - Cal.com Docs"
[7]: https://www.linkedin.com/legal/user-agreement "User Agreement | LinkedIn"
[8]: https://developer.x.com/en/developer-terms/agreement-and-policy "X Developer Policy - X"
[9]: https://support.reddithelp.com/hc/en-us/articles/42728983564564-Responsible-Builder-Policy "Responsible Builder Policy – Reddit Help"
[10]: https://support.discord.com/hc/en-us/articles/115002192352-Automated-User-Accounts-Self-Bots "Automated User Accounts (Self-Bots) – Discord"
[11]: https://www.ycombinator.com/companies/?batch=Fall+2025&utm_source=chatgpt.com "The YC Startup Directory | Y Combinator"
[12]: https://developers.openai.com/api/docs/guides/agents "Agents SDK | OpenAI API"
[13]: https://code.claude.com/docs/en/agent-sdk/overview "Agent SDK overview - Claude Code Docs"
[14]: https://adk.dev/ "Agent Development Kit (ADK) - Agent Development Kit (ADK)"
[15]: https://ai.google.dev/gemini-api/docs/computer-use "Gemini generateContent API  |  Google AI for Developers"
[16]: https://developers.openai.com/api/docs/guides/tools-computer-use "Computer use | OpenAI API"


