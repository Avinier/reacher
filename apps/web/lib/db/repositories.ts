import { browserPlatforms, type BrowserPlatform, type Platform, type RedditWritePayload, type RunKind } from "@reacher/shared";
import { getDb, id } from "./client";

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

export function createRun(input: { kind: RunKind; prompt: string; platforms: Platform[]; listId?: string; targetIds?: string[] }) {
  const db = getDb();
  const runId = id("run");
  const now = Date.now();
  db.prepare(
    `INSERT INTO runs (id, kind, status, prompt, settings_json, created_at, updated_at)
     VALUES (?, ?, 'queued', ?, ?, ?, ?)`
  ).run(runId, input.kind, input.prompt, JSON.stringify({ platforms: input.platforms, listId: input.listId, targetIds: input.targetIds }), now, now);
  db.prepare(
    `INSERT INTO run_steps (id, run_id, "index", status, kind, title, detail, started_at, completed_at)
     VALUES (?, ?, 0, 'completed', 'plan', 'Run queued', 'Waiting for the local runner to claim this job.', ?, ?)`
  ).run(id("step"), runId, now, now);
  return runId;
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

export function getRun(runId: string) {
  return getDb().prepare("SELECT * FROM runs WHERE id = ?").get(runId) as Row | undefined;
}

export function getRunDetail(runId: string) {
  return {
    run: getRun(runId),
    steps: getDb().prepare('SELECT * FROM run_steps WHERE run_id = ? ORDER BY "index"').all(runId) as Row[],
    filters: getDb().prepare("SELECT * FROM research_filters WHERE run_id = ? ORDER BY created_at").all(runId) as Row[],
    sources: getDb().prepare("SELECT * FROM sources WHERE run_id = ? ORDER BY captured_at").all(runId) as Row[],
    targets: getDb().prepare("SELECT * FROM targets WHERE run_id = ? ORDER BY relevance_score DESC, created_at").all(runId) as Row[],
    artifacts: getDb().prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY created_at DESC").all(runId) as Row[]
  };
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

export function listTargets(limit = 100) {
  return getDb().prepare("SELECT * FROM targets ORDER BY created_at DESC LIMIT ?").all(limit) as Row[];
}

export function getTargetDetail(targetId: string) {
  return {
    target: getDb().prepare("SELECT * FROM targets WHERE id = ?").get(targetId) as Row | undefined,
    evidence: getDb().prepare("SELECT * FROM target_evidence WHERE target_id = ? ORDER BY created_at DESC").all(targetId) as Row[],
    drafts: getDb().prepare("SELECT * FROM drafts WHERE target_id = ? ORDER BY created_at DESC").all(targetId) as Row[],
    actions: getDb().prepare("SELECT * FROM outreach_actions WHERE target_id = ? ORDER BY created_at DESC").all(targetId) as Row[]
  };
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
