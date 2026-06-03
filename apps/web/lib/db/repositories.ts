import { browserPlatforms, type BrowserPlatform, type GmailOutreachPayload, type LinkedInOutreachPayload, type Platform, type RedditWritePayload, type RunKind } from "@reacher/shared";
import { getDb, id } from "./client";
import { gmailDraftForRecipient, parseGmailRecipients } from "../gmail/outreach";
import { hasLinkedInUrl, linkedInDraftsForTarget } from "../linkedin/outreach";

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

function parseSettings(raw: unknown) {
  if (!raw) return {};
  if (typeof raw === "object") return raw as Record<string, unknown>;
  try {
    return JSON.parse(String(raw)) as Record<string, unknown>;
  } catch {
    return {};
  }
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

function ensureTargetOutreachColumn() {
  const db = getDb();
  const migrationIds = ["0003_target_outreach_toggle.sql", "0004_target_not_useful_feedback.sql"];
  const columns = db.prepare("PRAGMA table_info(targets)").all() as Row[];
  db.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);");
  if (!columns.some((column) => column.name === "outreached_at")) {
    db.exec("ALTER TABLE targets ADD COLUMN outreached_at integer");
  }
  if (!columns.some((column) => column.name === "not_useful_at")) {
    db.exec("ALTER TABLE targets ADD COLUMN not_useful_at integer");
  }
  const now = Date.now();
  for (const migrationId of migrationIds) {
    db.prepare("INSERT OR IGNORE INTO __drizzle_migrations (id, applied_at) VALUES (?, ?)").run(migrationId, now);
  }
}

function ensureRunRerunColumns() {
  const db = getDb();
  const migrationId = "0005_run_rerun_lineage.sql";
  const columns = db.prepare("PRAGMA table_info(runs)").all() as Row[];
  db.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);");
  if (!columns.some((column) => column.name === "parent_run_id")) {
    db.exec("ALTER TABLE runs ADD COLUMN parent_run_id text");
  }
  if (!columns.some((column) => column.name === "rerun_root_run_id")) {
    db.exec("ALTER TABLE runs ADD COLUMN rerun_root_run_id text");
  }
  if (!columns.some((column) => column.name === "rerun_index")) {
    db.exec("ALTER TABLE runs ADD COLUMN rerun_index integer");
  }
  db.prepare("INSERT OR IGNORE INTO __drizzle_migrations (id, applied_at) VALUES (?, ?)").run(migrationId, Date.now());
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

export function createRun(input: { kind: RunKind; prompt: string; platforms: Platform[]; researchMode?: "code_mode_first" | "code_mode_only" | "normal"; listId?: string; targetIds?: string[]; gmailOutreach?: GmailOutreachPayload; linkedinOutreach?: LinkedInOutreachPayload }) {
  ensureRunRerunColumns();
  const db = getDb();
  const runId = id("run");
  const now = Date.now();
  const settings = { platforms: input.platforms, researchMode: input.researchMode ?? "code_mode_first", listId: input.listId, targetIds: input.targetIds, gmailOutreach: input.gmailOutreach, linkedinOutreach: input.linkedinOutreach };
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

export function createRerun(sourceRunId: string) {
  ensureRunRerunColumns();
  const db = getDb();
  const source = db.prepare("SELECT * FROM runs WHERE id = ?").get(sourceRunId) as Row | undefined;
  if (!source) return undefined;
  if (source.kind !== "research") return undefined;
  if (!["completed", "failed"].includes(String(source.status))) return undefined;

  const settings = parseSettings(source.settings_json);
  const platforms = Array.isArray(settings.platforms) ? settings.platforms : ["web"];
  const rootRunId = String(source.rerun_root_run_id || source.id);
  const maxIndex = db.prepare(
    "SELECT COALESCE(MAX(rerun_index), 0) AS max_index FROM runs WHERE rerun_root_run_id = ? OR id = ?"
  ).get(rootRunId, rootRunId) as Row;
  const rerunIndex = Number(maxIndex.max_index ?? 0) + 1;
  const runId = id("run");
  const now = Date.now();
  const rerunSettings = {
    ...settings,
    platforms,
    rerun: {
      sourceRunId,
      rootRunId,
      index: rerunIndex,
      avoidLineageTargets: true,
      useFeedback: true
    }
  };
  db.prepare(
    `INSERT INTO runs (id, kind, status, prompt, settings_json, parent_run_id, rerun_root_run_id, rerun_index, created_at, updated_at)
     VALUES (?, 'research', 'queued', ?, ?, ?, ?, ?, ?, ?)`
  ).run(runId, String(source.prompt), JSON.stringify(rerunSettings), sourceRunId, rootRunId, rerunIndex, now, now);
  db.prepare(
    `INSERT INTO run_steps (id, run_id, "index", status, kind, title, detail, input_json, started_at, completed_at)
     VALUES (?, ?, 0, 'completed', 'plan', 'Rerun queued', ?, ?, ?, ?)`
  ).run(
    id("step"),
    runId,
    `Rerun ${rerunIndex} queued from ${sourceRunId}; runner will avoid prior lineage targets and use feedback signals.`,
    JSON.stringify({ sourceRunId, rootRunId, rerunIndex }),
    now,
    now
  );
  return { runId, sourceRunId, rootRunId, rerunIndex };
}

function selectedLinkedInTargets(input: { targetIds?: string[]; listIds?: string[] }) {
  const db = getDb();
  const selected = new Map<string, Row>();
  for (const targetId of input.targetIds || []) {
    const target = db.prepare("SELECT * FROM targets WHERE id = ?").get(targetId) as Row | undefined;
    if (target) selected.set(String(target.id), target);
  }
  for (const listId of input.listIds || []) {
    const targets = db.prepare(
      `SELECT targets.*
       FROM list_items JOIN targets ON targets.id = list_items.target_id
       WHERE list_items.list_id = ?
       ORDER BY list_items.rank`
    ).all(listId) as Row[];
    for (const target of targets) selected.set(String(target.id), target);
  }
  return Array.from(selected.values());
}

export function createLinkedInOutreachRun(input: { prompt: string; linkedinOutreach: LinkedInOutreachPayload }) {
  const db = getDb();
  const now = Date.now();
  const runId = id("run");
  const targets = selectedLinkedInTargets(input.linkedinOutreach);
  const valid = targets.filter((target) => hasLinkedInUrl(target.profile_url));
  const skipped = targets.filter((target) => !hasLinkedInUrl(target.profile_url));
  const settings = { platforms: ["linkedin"], linkedinOutreach: input.linkedinOutreach, skippedTargetIds: skipped.map((target) => target.id) };

  db.prepare(
    `INSERT INTO runs (id, kind, status, prompt, interpreted_goal, settings_json, result_summary, created_at, updated_at, started_at, completed_at)
     VALUES (?, 'outreach_prepare', 'waiting_for_operator', ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    runId,
    input.prompt,
    "Prepare supervised LinkedIn outreach actions from selected saved targets and lists.",
    JSON.stringify(settings),
    `Prepared ${valid.length} LinkedIn target${valid.length === 1 ? "" : "s"} for review. Skipped ${skipped.length} without LinkedIn URLs.`,
    now,
    now,
    now,
    now
  );
  db.prepare(
    `INSERT INTO run_steps (id, run_id, "index", status, kind, title, detail, input_json, output_json, started_at, completed_at)
     VALUES (?, ?, 0, 'completed', 'plan', 'LinkedIn outreach queued', ?, ?, ?, ?, ?)`
  ).run(id("step"), runId, `${valid.length} target(s) queued, ${skipped.length} skipped for missing LinkedIn URL.`, JSON.stringify(input.linkedinOutreach), JSON.stringify({ skipped: skipped.map((target) => target.id) }), now, now);

  valid.forEach((target, index) => {
    const targetId = String(target.id);
    const profileUrl = String(target.profile_url);
    const draft = linkedInDraftsForTarget(input.linkedinOutreach, {
      id: targetId,
      displayName: String(target.display_name),
      company: target.organization ? String(target.organization) : undefined,
      role: target.role_or_context ? String(target.role_or_context) : undefined,
      headline: target.why_relevant ? String(target.why_relevant) : undefined,
      notes: target.why_relevant ? String(target.why_relevant) : undefined,
      linkedInUrl: profileUrl
    });
    const draftId = id("draft");
    const actionId = id("act");
    db.prepare(
      `INSERT INTO drafts (id, target_id, run_id, platform, draft_type, body, evidence_summary, status, created_at, updated_at)
       VALUES (?, ?, ?, 'linkedin', 'connection_note', ?, ?, 'generated', ?, ?)`
    ).run(draftId, targetId, runId, JSON.stringify({ connectionNote: draft.connectionNote, dm: draft.dm }), `Deterministic LinkedIn connect-note-first draft. ${draft.snippet}`, now + index, now + index);
    db.prepare(
      `INSERT INTO outreach_actions (id, run_id, target_id, draft_id, platform, action_type, status, result_note, created_at, updated_at)
       VALUES (?, ?, ?, ?, 'linkedin', 'linkedin_prepare_connection_note', 'queued', ?, ?, ?)`
    ).run(actionId, runId, targetId, draftId, JSON.stringify({ approved: false, profileUrl, stageType: "connect_note_first", connectionNote: draft.connectionNote, dm: draft.dm }), now + index, now + index);
    db.prepare("UPDATE targets SET status = 'drafted', updated_at = ? WHERE id = ?").run(now + index, targetId);
  });

  skipped.forEach((target, index) => {
    const targetId = String(target.id);
    db.prepare(
      `INSERT INTO outreach_actions (id, run_id, target_id, platform, action_type, status, result_note, created_at, updated_at)
       VALUES (?, ?, ?, 'linkedin', 'linkedin_resolve_profile_skipped', 'failed', ?, ?, ?)`
    ).run(id("act"), runId, targetId, JSON.stringify({ reason: "missing_linkedin_url" }), now + valid.length + index, now + valid.length + index);
  });

  return { runId, queued: valid.length, skipped: skipped.length };
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
  ensureRunRerunColumns();
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
  ensureRunRerunColumns();
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

export function approveLinkedInAction(actionId: string, approved: boolean) {
  const db = getDb();
  const action = db.prepare("SELECT * FROM outreach_actions WHERE id = ? AND platform = 'linkedin'").get(actionId) as Row | undefined;
  if (!action) throw new Error("LinkedIn outreach action not found");
  const now = Date.now();
  const note = { ...parseJsonObject(action.result_note), approved };
  db.prepare("UPDATE outreach_actions SET result_note = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(note), now, actionId);
  if (action.draft_id) {
    db.prepare("UPDATE drafts SET status = ?, updated_at = ? WHERE id = ?").run(approved ? "approved_for_prepare" : "generated", now, String(action.draft_id));
  }
  return { actionId, approved };
}

export function recordLinkedInStaged(actionId: string, input: { providerSessionId: string; liveUrl?: string | null; browserSessionId?: string; startUrl: string }) {
  const db = getDb();
  const action = db.prepare("SELECT * FROM outreach_actions WHERE id = ? AND platform = 'linkedin'").get(actionId) as Row | undefined;
  if (!action) throw new Error("LinkedIn outreach action not found");
  const now = Date.now();
  const note = { ...parseJsonObject(action.result_note), providerSessionId: input.providerSessionId, liveUrl: input.liveUrl, browserSessionId: input.browserSessionId, startUrl: input.startUrl };
  db.prepare("UPDATE outreach_actions SET status = 'waiting_for_operator', result_note = ?, browser_session_id = COALESCE(?, browser_session_id), updated_at = ? WHERE id = ?").run(JSON.stringify(note), input.browserSessionId ?? null, now, actionId);
  if (action.draft_id) db.prepare("UPDATE drafts SET status = 'prepared', updated_at = ? WHERE id = ?").run(now, String(action.draft_id));
  db.prepare("UPDATE targets SET status = 'prepared', updated_at = ? WHERE id = ?").run(now, String(action.target_id));
  return { actionId, liveUrl: input.liveUrl };
}

export function recordLinkedInOperatorSent(actionId: string) {
  const db = getDb();
  const action = db.prepare("SELECT * FROM outreach_actions WHERE id = ? AND platform = 'linkedin'").get(actionId) as Row | undefined;
  if (!action) throw new Error("LinkedIn outreach action not found");
  const now = Date.now();
  const note = { ...parseJsonObject(action.result_note), operatorSentAt: now };
  db.prepare("UPDATE outreach_actions SET action_type = 'linkedin_operator_sent', status = 'done', result_note = ?, updated_at = ? WHERE id = ?").run(JSON.stringify(note), now, actionId);
  db.prepare("UPDATE targets SET status = 'sent_by_user', updated_at = ? WHERE id = ?").run(now, String(action.target_id));
  return { actionId, sentAt: now };
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

export function listOutreachTargetOptions(limit = 100) {
  ensureTargetOutreachColumn();
  return getDb().prepare(
    `SELECT id, display_name, platform, profile_url, organization
     FROM targets
     ORDER BY updated_at DESC, created_at DESC
     LIMIT ?`
  ).all(limit) as Row[];
}

export function getTargetOutreachStats(now = new Date()) {
  ensureTargetOutreachColumn();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const row = getDb().prepare(
    `SELECT
       COALESCE(SUM(CASE WHEN outreached_at >= ? THEN 1 ELSE 0 END), 0) AS outreached_today,
       COALESCE(SUM(CASE WHEN outreached_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS outreached_total,
       COALESCE(SUM(CASE WHEN not_useful_at IS NOT NULL THEN 1 ELSE 0 END), 0) AS not_useful_total
     FROM targets`
  ).get(dayStart.getTime()) as Row | undefined;
  return {
    outreachedToday: Number(row?.outreached_today ?? 0),
    outreachedTotal: Number(row?.outreached_total ?? 0),
    notUsefulTotal: Number(row?.not_useful_total ?? 0),
    dayStart: dayStart.getTime()
  };
}

export function getListDetail(listId: string) {
  ensureTargetOutreachColumn();
  return {
    list: getDb().prepare("SELECT * FROM lists WHERE id = ?").get(listId) as Row | undefined,
    targets: getDb().prepare(
      `SELECT targets.*, list_items.rank, list_items.notes
       FROM list_items JOIN targets ON targets.id = list_items.target_id
       WHERE list_items.list_id = ?
         AND targets.target_type IN ('person', 'company', 'account', 'creator', 'user')
       ORDER BY list_items.rank`
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
  ensureTargetOutreachColumn();
  return getDb().prepare("SELECT * FROM targets WHERE target_type IN ('person', 'company', 'account', 'creator', 'user') ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
}

export function listTargetsByRun(limit = 50) {
  ensureTargetOutreachColumn();
  return getDb().prepare(
    `WITH recent_runs AS (
       SELECT runs.*
       FROM runs
       JOIN targets ON targets.run_id = runs.id
       WHERE targets.target_type IN ('person', 'company', 'account', 'creator', 'user')
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
     WHERE targets.target_type IN ('person', 'company', 'account', 'creator', 'user')
     ORDER BY recent_runs.created_at DESC, COALESCE(targets.relevance_score, 0) DESC, targets.created_at DESC`
  ).all(limit) as Row[];
}

export function getTargetDetail(targetId: string) {
  ensureTargetOutreachColumn();
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

export function setTargetOutreached(targetId: string, outreached: boolean) {
  ensureTargetOutreachColumn();
  const now = Date.now();
  const result = getDb().prepare(
    "UPDATE targets SET outreached_at = ?, updated_at = ? WHERE id = ?"
  ).run(outreached ? now : null, now, targetId);
  if (result.changes === 0) return undefined;
  return getDb().prepare("SELECT id, outreached_at FROM targets WHERE id = ?").get(targetId) as Row | undefined;
}

export function setTargetFeedback(targetId: string, feedback: { outreached?: boolean; notUseful?: boolean }) {
  ensureTargetOutreachColumn();
  const now = Date.now();
  const target = getDb().prepare("SELECT * FROM targets WHERE id = ?").get(targetId) as Row | undefined;
  if (!target) return undefined;
  const outreachedAt = typeof feedback.outreached === "boolean" ? (feedback.outreached ? now : null) : (target.outreached_at as SqlValue);
  const notUsefulAt = typeof feedback.notUseful === "boolean" ? (feedback.notUseful ? now : null) : (target.not_useful_at as SqlValue);
  getDb().prepare(
    "UPDATE targets SET outreached_at = ?, not_useful_at = ?, updated_at = ? WHERE id = ?"
  ).run(outreachedAt, notUsefulAt, now, targetId);
  return getDb().prepare("SELECT id, outreached_at, not_useful_at FROM targets WHERE id = ?").get(targetId) as Row | undefined;
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
