import { browserPlatforms, type BrowserPlatform, type GmailOutreachPayload, type Platform, type RedditWritePayload, type RunKind } from "@reacher/shared";
import { getDb, id } from "./client";
import { gmailDraftForRecipient, parseGmailRecipients } from "../gmail/outreach";

type Row = Record<string, unknown>;
type SqlValue = string | number | bigint | null;

const platformLabels: Record<BrowserPlatform, string> = {
  linkedin: "LinkedIn",
  x: "X",
  reddit: "Reddit",
  discord: "Discord"
};

function cleanRedditUsername(username: string) {
  return username.replace(/^\/?u\//i, "");
}

function ensureUsageEventsTable() {
  getDb().exec(
    `CREATE TABLE IF NOT EXISTS run_usage_events (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      provider text NOT NULL,
      service text NOT NULL,
      operation text NOT NULL,
      model text,
      quantity real NOT NULL,
      unit text NOT NULL,
      unit_cost_usd real,
      estimated_cost_usd real,
      input_tokens integer,
      output_tokens integer,
      total_tokens integer,
      cost_basis text NOT NULL,
      metadata_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS run_usage_events_run_id_idx ON run_usage_events (run_id);`
  );
}

function ensureResearchRuntimeTables() {
  getDb().exec(
    `CREATE TABLE IF NOT EXISTS research_candidates (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      name text NOT NULL,
      company text,
      role text,
      url text,
      platform text NOT NULL,
      source_url text,
      reason text,
      confidence real,
      status text NOT NULL,
      metadata_json text,
      created_at integer NOT NULL,
      updated_at integer,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS research_candidates_run_id_idx ON research_candidates (run_id);
    CREATE TABLE IF NOT EXISTS research_enrichments (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      candidate_id text,
      query text,
      platform text NOT NULL,
      url text,
      title text,
      summary text,
      evidence_type text,
      confidence real,
      status text NOT NULL,
      error text,
      metadata_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade,
      FOREIGN KEY (candidate_id) REFERENCES research_candidates(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS research_enrichments_run_id_idx ON research_enrichments (run_id);
    CREATE INDEX IF NOT EXISTS research_enrichments_candidate_id_idx ON research_enrichments (candidate_id);
    CREATE TABLE IF NOT EXISTS research_scorecards (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      candidate_id text,
      target_id text,
      icp_fit integer,
      pain_evidence integer,
      reachability integer,
      call_likelihood integer,
      design_partner integer,
      total_score real,
      rationale text,
      metadata_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade,
      FOREIGN KEY (candidate_id) REFERENCES research_candidates(id) ON DELETE cascade,
      FOREIGN KEY (target_id) REFERENCES targets(id) ON DELETE set null
    );
    CREATE INDEX IF NOT EXISTS research_scorecards_run_id_idx ON research_scorecards (run_id);
    CREATE INDEX IF NOT EXISTS research_scorecards_candidate_id_idx ON research_scorecards (candidate_id);
    CREATE TABLE IF NOT EXISTS research_checkpoints (
      id text PRIMARY KEY NOT NULL,
      run_id text NOT NULL,
      name text NOT NULL,
      data_json text,
      created_at integer NOT NULL,
      FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE cascade
    );
    CREATE INDEX IF NOT EXISTS research_checkpoints_run_id_idx ON research_checkpoints (run_id);`
  );
}

export function ensureBrowserContexts() {
  const db = getDb();
  const now = Date.now();
  for (const platform of browserPlatforms) {
    db.prepare(
      `INSERT INTO browser_contexts
        (id, platform, display_name, provider, status, created_at, updated_at)
       VALUES (?, ?, ?, 'browserbase', 'needs_login', ?, ?)
       ON CONFLICT(platform) DO NOTHING`
    ).run(id("ctx"), platform, platformLabels[platform], now, now);
  }
}

export function ensureIntegrationsTable() {
  getDb().exec(
    `CREATE TABLE IF NOT EXISTS integrations (
      id text PRIMARY KEY NOT NULL,
      provider text NOT NULL,
      account_label text,
      account_email text,
      scopes text,
      access_token text,
      refresh_token text,
      expires_at integer,
      connected_at integer NOT NULL,
      disconnected_at integer,
      created_at integer NOT NULL,
      updated_at integer
    );
    CREATE UNIQUE INDEX IF NOT EXISTS integrations_provider_idx ON integrations (provider);`
  );
}

export function getGmailIntegration() {
  ensureIntegrationsTable();
  return getDb().prepare("SELECT * FROM integrations WHERE provider = 'gmail' AND disconnected_at IS NULL").get() as Row | undefined;
}

export function upsertGmailIntegration(input: {
  accountLabel?: string | null;
  accountEmail?: string | null;
  scopes?: string | null;
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
}) {
  ensureIntegrationsTable();
  const db = getDb();
  const now = Date.now();
  const existing = db.prepare("SELECT * FROM integrations WHERE provider = 'gmail'").get() as Row | undefined;
  const integrationId = existing?.id ? String(existing.id) : id("int");
  db.prepare(
    `INSERT INTO integrations
      (id, provider, account_label, account_email, scopes, access_token, refresh_token, expires_at, connected_at, disconnected_at, created_at, updated_at)
     VALUES (?, 'gmail', ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)
     ON CONFLICT(provider) DO UPDATE SET
       account_label = excluded.account_label,
       account_email = excluded.account_email,
       scopes = excluded.scopes,
       access_token = excluded.access_token,
       refresh_token = COALESCE(excluded.refresh_token, integrations.refresh_token),
       expires_at = excluded.expires_at,
       connected_at = excluded.connected_at,
       disconnected_at = NULL,
       updated_at = excluded.updated_at`
  ).run(
    integrationId,
    input.accountLabel ?? null,
    input.accountEmail ?? null,
    input.scopes ?? null,
    input.accessToken ?? null,
    input.refreshToken ?? null,
    input.expiresAt ?? null,
    now,
    now,
    now
  );
  return getGmailIntegration();
}

export function disconnectGmailIntegration() {
  ensureIntegrationsTable();
  const now = Date.now();
  getDb().prepare(
    `UPDATE integrations
     SET access_token = NULL, refresh_token = NULL, expires_at = NULL, disconnected_at = ?, updated_at = ?
     WHERE provider = 'gmail'`
  ).run(now, now);
}

export function getBrowserContexts() {
  ensureBrowserContexts();
  return getDb().prepare("SELECT * FROM browser_contexts ORDER BY display_name").all() as Row[];
}

export function getBrowserContext(platform: BrowserPlatform) {
  ensureBrowserContexts();
  return getDb().prepare("SELECT * FROM browser_contexts WHERE platform = ?").get(platform) as Row | undefined;
}

export function updateContext(platform: BrowserPlatform, fields: { status?: string; providerContextId?: string; lastSessionId?: string; accountLabel?: string; lastError?: string; verified?: boolean }) {
  const current = getBrowserContext(platform);
  if (!current) throw new Error(`Unknown platform context: ${platform}`);
  const status = (fields.status ?? current.status) as SqlValue;
  const verifiedAt = fields.verified ? Date.now() : (current.last_verified_at as SqlValue);
  getDb().prepare(
    `UPDATE browser_contexts
     SET status = ?, provider_context_id = COALESCE(?, provider_context_id),
         last_session_id = COALESCE(?, last_session_id),
         account_label = COALESCE(?, account_label),
         last_error = ?, last_verified_at = ?, updated_at = ?
     WHERE platform = ?`
  ).run(status, fields.providerContextId ?? null, fields.lastSessionId ?? null, fields.accountLabel ?? null, fields.lastError ?? null, verifiedAt ?? null, Date.now(), platform);
}

export function createRun(input: { kind: RunKind; prompt: string; platforms: Platform[]; listId?: string; targetIds?: string[]; gmailOutreach?: GmailOutreachPayload }) {
  const db = getDb();
  const runId = id("run");
  const now = Date.now();
  const settings = { platforms: input.platforms, listId: input.listId, targetIds: input.targetIds, gmailOutreach: input.gmailOutreach };
  db.prepare(
    `INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, ?)`
  ).run(runId, input.kind, input.prompt, JSON.stringify(settings), now, now);
  db.prepare(
    `INSERT INTO run_steps (id, run_id, "index", status, kind, title, detail, started_at, completed_at)
     VALUES (?, ?, 0, 'completed', 'plan', 'Run queued', 'Waiting for the local runner to claim this job.', ?, ?)`
  ).run(id("step"), runId, now, now);
  return runId;
}

export async function createGmailOutreachRun(input: { prompt: string; gmailOutreach: GmailOutreachPayload }) {
  const db = getDb();
  const now = Date.now();
  const runId = id("run");
  const parsed = parseGmailRecipients(input.gmailOutreach.recipientsRaw);
  const settings = { platforms: ["email"], gmailOutreach: input.gmailOutreach, recipientErrors: parsed.errors };

  db.prepare(
    `INSERT INTO runs (id, kind, status, prompt, interpreted_goal, settings_json, result_summary, created_at, updated_at, started_at, completed_at)
     VALUES (?, 'outreach_prepare', 'waiting_for_operator', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    input.prompt,
    "Prepare reviewed Gmail outreach drafts from operator-provided recipients.",
    JSON.stringify(settings),
    `Prepared ${parsed.recipients.length} Gmail draft${parsed.recipients.length === 1 ? "" : "s"} for review.${parsed.errors.length ? ` ${parsed.errors.length} row error(s).` : ""}`,
    now,
    now,
    now,
    now
  );
  db.prepare(
    `INSERT INTO run_steps (id, run_id, "index", status, kind, title, detail, input_json, output_json, started_at, completed_at)
     VALUES (?, ?, 0, 'completed', 'plan', 'Gmail outreach parsed', ?, ?, ?, ?, ?)`
  ).run(
    id("step"),
    runId,
    `${parsed.recipients.length} valid recipient row(s), ${parsed.errors.length} invalid row(s).`,
    JSON.stringify({ draftMode: input.gmailOutreach.draftMode }),
    JSON.stringify({ errors: parsed.errors }),
    now,
    now
  );

  for (let index = 0; index < parsed.recipients.length; index += 1) {
    const recipient = parsed.recipients[index];
    const draft = await gmailDraftForRecipient(input.gmailOutreach, recipient, input.prompt);
    const targetId = id("target");
    const draftId = id("draft");
    const actionId = id("act");
    const metadata = {
      email: recipient.email,
      row_number: recipient.rowNumber,
      gmail: { draft_id: null, message_id: null, sent_at: null }
    };
    db.prepare(
      `INSERT INTO targets
        (id, run_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, 'email', 'person', ?, ?, ?, ?, ?, ?, ?, 'drafted', ?, ?, ?)`
    ).run(
      targetId,
      runId,
      recipient.displayName,
      recipient.email,
      `mailto:${recipient.email}`,
      recipient.company ?? null,
      recipient.role ?? null,
      1,
      recipient.notes || `Operator-provided Gmail outreach recipient${recipient.company ? ` at ${recipient.company}` : ""}.`,
      JSON.stringify(metadata),
      now + index,
      now + index
    );
    db.prepare(
      `INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at)
       VALUES (?, ?, ?, 'email', 'email', ?, ?, 'generated', ?, ?)`
    ).run(draftId, targetId, runId, JSON.stringify({ subject: draft.subject, body: draft.body }), `Gmail ${input.gmailOutreach.draftMode} draft for ${recipient.email}.`, now + index, now + index);
    db.prepare(
      `INSERT INTO outreach_actions (id, run_id, target_id, draft_id, platform, action_type, status, result_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'email', 'create_gmail_draft', 'queued', ?, ?, ?)`
    ).run(actionId, runId, targetId, draftId, JSON.stringify({ email: recipient.email, subject: draft.subject, approved: false }), now + index, now + index);
  }

  return { runId, validRecipients: parsed.recipients.length, errors: parsed.errors };
}

export function queueRedditWriteAction(input: RedditWritePayload) {
  const db = getDb();
  const now = Date.now();
  const runId = id("run");
  const targetId = input.targetId ?? id("target");
  const draftId = input.draftId ?? id("draft");
  const actionId = id("act");
  const targetLabel =
    input.actionType === "submit_post" ? `r/${input.subredditName}` :
    input.actionType === "submit_comment" ? String(input.postId) :
    `u/${input.username}`;
  const targetType = input.actionType === "submit_post" ? "community" : input.actionType === "submit_comment" ? "thread" : "account";
  const draftType = input.actionType === "submit_post" ? "post" : input.actionType === "submit_comment" ? "comment" : "dm";
  const prompt =
    input.actionType === "submit_post" ? `Submit Reddit post to r/${input.subredditName}` :
    input.actionType === "submit_comment" ? `Submit Reddit comment to ${input.postId}` :
    `Send Reddit private message to u/${input.username}`;

  db.prepare(
    `INSERT INTO runs (id, kind, status, prompt, settings_json, result_summary, created_at, updated_at)
     VALUES (?, 'reddit_write', 'waiting_for_operator', ?, ?, ?, ?, ?)`
  ).run(runId, prompt, JSON.stringify({ platforms: ["reddit"], redditAction: input }), "Queued explicit Reddit write action for Devvit execution.", now, now);
  db.prepare(
    `INSERT INTO run_steps (id, run_id, "index", status, kind, title, detail, input_json, started_at, completed_at)
     VALUES (?, ?, 0, 'completed', 'operator_wait', 'Reddit write action queued', ?, ?, ?, ?)`
  ).run(id("step"), runId, `Action ${input.actionType} is ready for explicit operator execution through Devvit.`, JSON.stringify(input), now, now);

  if (!input.targetId) {
    db.prepare(
      `INSERT INTO targets (id, run_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, relevance_score, why_relevant, status, metadata_json, created_at, updated_at)
       VALUES (?, ?, 'reddit', ?, ?, ?, ?, ?, ?, ?, ?, 'drafted', ?, ?, ?)`
    ).run(
      targetId,
      runId,
      targetType,
      targetLabel,
      input.username ?? input.subredditName ?? input.postId ?? null,
      input.username ? `https://www.reddit.com/user/${cleanRedditUsername(input.username)}/` : input.subredditName ? `https://www.reddit.com/r/${input.subredditName}/` : null,
      input.subredditName ? `r/${input.subredditName}` : null,
      "Explicit Reddit write target",
      1,
      "Created from an operator-specified Reddit write action.",
      JSON.stringify({ reddit_action_type: input.actionType }),
      now,
      now
    );
  }

  if (!input.draftId) {
    db.prepare(
      `INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at)
       VALUES (?, ?, ?, 'reddit', ?, ?, ?, 'approved_for_prepare', ?, ?)`
    ).run(draftId, targetId, runId, draftType, input.text, "Operator-provided Reddit write text.", now, now);
  }

  db.prepare(
    `INSERT INTO outreach_actions (id, run_id, target_id, draft_id, platform, action_type, status, result_note, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'reddit', ?, 'waiting_for_operator', ?, ?, ?)`
  ).run(actionId, runId, targetId, draftId, input.actionType, JSON.stringify({ devvitApp: "reacher-usage", playtestSubreddit: "reacher_usage_dev", payload: input }), now, now);

  return { runId, targetId, draftId, actionId };
}

export function listRuns(limit = 25) {
  return getDb().prepare("SELECT * FROM runs ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
}

export function listRunsByMode(mode: "research" | "outreach", limit = 100) {
  const kinds = mode === "research" ? ["research"] : ["outreach_prepare", "reddit_write"];
  return getDb().prepare(`SELECT * FROM runs WHERE kind IN (${kinds.map(() => "?").join(", ")}) ORDER BY created_at DESC LIMIT ?`).all(...kinds, limit) as Row[];
}

export function getRun(runId: string) {
  return getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Row | undefined;
}

export function deleteRun(runId: string) {
  const db = getDb();
  const run = getRun(runId);
  if (!run) return false;
  db.prepare("DELETE FROM runs WHERE id = ?").run(runId);
  return true;
}

export function getRunDetail(runId: string) {
  ensureUsageEventsTable();
  ensureResearchRuntimeTables();
  return {
    run: getRun(runId),
    steps: getDb().prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY "index"').all(runId) as Row[],
    usage: getDb().prepare("SELECT * FROM run_usage_events WHERE run_id = ? ORDER BY created_at").all(runId) as Row[],
    usageSummary: getDb().prepare(
      `SELECT COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM run_usage_events WHERE run_id = ?`
    ).get(runId) as Row,
    usageByProvider: getDb().prepare(
      `SELECT provider, service, unit,
              COUNT(*) AS events,
              COALESCE(SUM(quantity), 0) AS quantity,
              COALESCE(SUM(estimated_cost_usd), 0) AS estimated_cost_usd,
              COALESCE(SUM(input_tokens), 0) AS input_tokens,
              COALESCE(SUM(output_tokens), 0) AS output_tokens,
              COALESCE(SUM(total_tokens), 0) AS total_tokens
       FROM run_usage_events
       WHERE run_id = ?
       GROUP BY provider, service, unit
       ORDER BY provider, service`
    ).all(runId) as Row[],
    filters: getDb().prepare("SELECT * FROM research_filters WHERE run_id = ? ORDER BY created_at").all(runId) as Row[],
    sources: getDb().prepare("SELECT * FROM sources WHERE run_id = ? ORDER BY captured_at").all(runId) as Row[],
    candidates: getDb().prepare("SELECT * FROM research_candidates WHERE run_id = ? ORDER BY confidence DESC, created_at").all(runId) as Row[],
    enrichments: getDb().prepare("SELECT * FROM research_enrichments WHERE run_id = ? ORDER BY created_at").all(runId) as Row[],
    scorecards: getDb().prepare("SELECT * FROM research_scorecards WHERE run_id = ? ORDER BY total_score DESC, created_at").all(runId) as Row[],
    checkpoints: getDb().prepare("SELECT * FROM research_checkpoints WHERE run_id = ? ORDER BY created_at DESC LIMIT 20").all(runId) as Row[],
    targets: getDb().prepare("SELECT * FROM targets WHERE run_id = ? ORDER BY relevance_score DESC, created_at").all(runId) as Row[],
    drafts: getDb().prepare("SELECT drafts.*, targets.display_name, targets.handle, targets.organization FROM drafts JOIN targets ON targets.id = drafts.target_id WHERE drafts.run_id = ? ORDER BY drafts.created_at").all(runId) as Row[],
    actions: getDb().prepare("SELECT outreach_actions.*, targets.display_name, targets.handle, targets.organization, drafts.body FROM outreach_actions JOIN targets ON targets.id = outreach_actions.target_id LEFT JOIN drafts ON drafts.id = outreach_actions.draft_id WHERE outreach_actions.run_id = ? ORDER BY outreach_actions.created_at").all(runId) as Row[],
    artifacts: getDb().prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at DESC").all(runId) as Row[]
  };
}

function parseJsonObject(raw: unknown) {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export function approveGmailDraft(actionId: string, approved: boolean) {
  const db = getDb();
  const action = db.prepare("SELECT * FROM outreach_actions WHERE id = ? AND platform = 'email'").get(actionId) as Row | undefined;
  if (!action) throw new Error("Gmail outreach action not found");
  const now = Date.now();
  const note = { ...parseJsonObject(action.result_note), approved };
  db.prepare("UPDATE outreach_actions SET result_note = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(note), now, actionId);
  db.prepare("UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?").run(approved ? "approved_for_prepare" : "generated", now, String(action.draft_id));
  return { actionId, approved };
}

export function recordGmailDraftCreated(actionId: string, input: { gmailDraftId?: string; gmailMessageId?: string }) {
  const db = getDb();
  const action = db.prepare("SELECT * FROM outreach_actions WHERE id = ? AND platform = 'email'").get(actionId) as Row | undefined;
  if (!action) throw new Error("Gmail outreach action not found");
  const now = Date.now();
  const note = { ...parseJsonObject(action.result_note), gmailDraftId: input.gmailDraftId, gmailMessageId: input.gmailMessageId };
  const targetRow = db.prepare("SELECT metadata_json FROM targets WHERE id = ?").get(String(action.target_id)) as Row | undefined;
  const targetMetadata = parseJsonObject(targetRow?.metadata_json);
  const gmail = { ...(parseJsonObject(targetMetadata.gmail)), draft_id: input.gmailDraftId, message_id: input.gmailMessageId };
  db.prepare("UPDATE outreach_actions SET status = 'prepared', result_note = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(note), now, actionId);
  db.prepare("UPDATE drafts SET status = 'prepared', updated_at = ? WHERE id = ?").run(now, String(action.draft_id));
  db.prepare("UPDATE targets SET status = 'prepared', metadata_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ ...targetMetadata, gmail }), now, String(action.target_id));
  return { actionId, gmailDraftId: input.gmailDraftId };
}

export function recordGmailSent(actionId: string, input: { gmailMessageId?: string; gmailThreadId?: string }) {
  const db = getDb();
  const action = db.prepare("SELECT * FROM outreach_actions WHERE id = ? AND platform = 'email'").get(actionId) as Row | undefined;
  if (!action) throw new Error("Gmail outreach action not found");
  const now = Date.now();
  const note = { ...parseJsonObject(action.result_note), gmailSentMessageId: input.gmailMessageId, gmailThreadId: input.gmailThreadId, sentAt: now };
  const targetRow = db.prepare("SELECT metadata_json FROM targets WHERE id = ?").get(String(action.target_id)) as Row | undefined;
  const targetMetadata = parseJsonObject(targetRow?.metadata_json);
  const gmail = { ...(parseJsonObject(targetMetadata.gmail)), message_id: input.gmailMessageId, thread_id: input.gmailThreadId, sent_at: now };
  db.prepare("UPDATE outreach_actions SET action_type = 'send_gmail_draft', status = 'done', result_note = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(note), now, actionId);
  db.prepare("UPDATE targets SET status = 'sent_by_user', metadata_json = ?, updated_at = ? WHERE id = ?").run(JSON.stringify({ ...targetMetadata, gmail }), now, String(action.target_id));
  return { actionId, sentAt: now };
}

export function listLists() {
  return getDb().prepare(
    `SELECT lists.*, COUNT(list_items.id) AS target_count
     FROM lists LEFT JOIN list_items ON lists.id = list_items.list_id
     GROUP BY lists.id ORDER BY lists.created_at DESC`
  ).all() as Row[];
}

export function getListDetail(listId: string) {
  return {
    list: getDb().prepare("SELECT * FROM lists WHERE id = ?").get(listId) as Row | undefined,
    targets: getDb().prepare(
      `SELECT targets.*, list_items.rank, list_items.notes
       FROM list_items JOIN targets ON targets.id = list_items.target_id
       WHERE list_items.list_id = ? ORDER BY list_items.rank`
    ).all(listId) as Row[]
  };
}

export function deleteList(listId: string) {
  const db = getDb();
  const list = db.prepare("SELECT * FROM lists WHERE id = ?").get(listId) as Row | undefined;
  if (!list) return false;
  db.prepare("UPDATE targets SET list_id = NULL WHERE list_id = ?").run(listId);
  db.prepare("DELETE FROM lists WHERE id = ?").run(listId);
  return true;
}

export function listTargets(limit = 100) {
  return getDb().prepare("SELECT * FROM targets ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
}

export function listTargetsByRun(limit = 50) {
  return getDb().prepare(
    `WITH recent_runs AS (
       SELECT runs.*
       FROM runs
       JOIN targets ON targets.run_id = runs.id
       GROUP BY runs.id
       ORDER BY runs.created_at DESC
       LIMIT ?
     )
     SELECT targets.*,
            recent_runs.kind AS run_kind,
            recent_runs.status AS run_status,
            recent_runs.prompt AS run_prompt,
            recent_runs.created_at AS run_created_at,
            recent_runs.completed_at AS run_completed_at
     FROM recent_runs
     JOIN targets ON targets.run_id = recent_runs.id
     ORDER BY recent_runs.created_at DESC, COALESCE(targets.relevance_score, 0) DESC, targets.created_at DESC`
  ).all(limit) as Row[];
}

export function getTargetDetail(targetId: string) {
  return {
    target: getDb().prepare(
      `SELECT targets.*,
              runs.kind AS run_kind,
              runs.status AS run_status,
              runs.prompt AS run_prompt,
              runs.created_at AS run_created_at,
              runs.completed_at AS run_completed_at
       FROM targets
       JOIN runs ON runs.id = targets.run_id
       WHERE targets.id = ?`
    ).get(targetId) as Row | undefined,
    evidence: getDb().prepare("SELECT * FROM target_evidence WHERE target_id = ? ORDER BY created_at DESC").all(targetId) as Row[],
    drafts: getDb().prepare("SELECT * FROM drafts WHERE target_id = ? ORDER BY created_at DESC").all(targetId) as Row[],
    actions: getDb().prepare("SELECT * FROM outreach_actions WHERE target_id = ? ORDER BY created_at DESC").all(targetId) as Row[],
    researchRuns: getDb().prepare(
      `SELECT *
       FROM runs
       WHERE kind = 'research'
         AND settings_json LIKE ?
       ORDER BY created_at DESC`
    ).all(`%"${targetId}"%`) as Row[]
  };
}

export function createTargetResearchRun(targetId: string) {
  const target = getDb().prepare("SELECT * FROM targets WHERE id = ?").get(targetId) as Row | undefined;
  if (!target) return undefined;
  const platform = String(target.platform) as Platform;
  const platforms: Platform[] = platform === "web" ? ["web", "linkedin", "x", "reddit"] : ["web", platform];
  const profileUrl = target.profile_url ? ` Profile URL: ${String(target.profile_url)}.` : "";
  const handle = target.handle ? ` Handle: ${String(target.handle)}.` : "";
  const organization = target.organization ? ` Organization: ${String(target.organization)}.` : "";
  const role = target.role_or_context ? ` Role/context: ${String(target.role_or_context)}.` : "";
  const prompt = [
    `Research further on ${String(target.display_name)}.`,
    "Find everything useful for outreach: current role, company, public projects, recent posts, communities, contact-relevant context, credibility signals, and concrete evidence with source URLs.",
    `Original relevance note: ${String(target.why_relevant ?? "No note saved.")}`,
    profileUrl,
    handle,
    organization,
    role
  ].join(" ").replace(/\s+/g, " ").trim();

  return createRun({ kind: "research", prompt, platforms: Array.from(new Set(platforms)), targetIds: [targetId] });
}

export function listDrafts() {
  return getDb().prepare(
    `SELECT drafts.*, targets.display_name, targets.profile_url
     FROM drafts JOIN targets ON targets.id = drafts.target_id
     ORDER BY drafts.created_at DESC`
  ).all() as Row[];
}

export function listRedditActions(limit = 50) {
  return getDb().prepare(
    `SELECT outreach_actions.*, targets.display_name, targets.handle, targets.profile_url, drafts.body
     FROM outreach_actions
     JOIN targets ON targets.id = outreach_actions.target_id
     LEFT JOIN drafts ON drafts.id = outreach_actions.draft_id
     WHERE outreach_actions.platform = 'reddit'
     ORDER BY outreach_actions.created_at DESC
     LIMIT ?`
  ).all(limit) as Row[];
}

export function listExports() {
  return getDb().prepare(
    `SELECT exports.*, artifacts.path, artifacts.title, artifacts.provider_url
     FROM exports JOIN artifacts ON artifacts.id = exports.artifact_id
     ORDER BY exports.created_at DESC`
  ).all() as Row[];
}
