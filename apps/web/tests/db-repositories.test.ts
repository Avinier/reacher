import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createGmailOutreachRun, createRun, createTargetResearchRun, deleteList, deleteRun, disconnectGmailIntegration, ensureBrowserContexts, getGmailIntegration, getRunDetail, getTargetDetail, listLists, listRedditActions, listRuns, listRunsByMode, listTargetsByRun, queueRedditWriteAction, upsertGmailIntegration } from "../lib/db/repositories";
import { getDb, resetDbForTests } from "../lib/db/client";

let tempDir: string;

function applyMigration(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  const migrationsDir = resolve(__dirname, "../../../apps/web/db/migrations");
  for (const file of readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()) {
    const migration = readFileSync(resolve(migrationsDir, file), "utf8");
    for (const statement of migration.split("--> statement-breakpoint")) {
      const sql = statement.trim();
      if (sql) db.exec(sql);
    }
  }
  db.close();
}

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "reacher-web-test-"));
  const dbPath = join(tempDir, "reacher.sqlite");
  applyMigration(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  resetDbForTests();
});

afterEach(() => {
  resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("web SQLite repositories", () => {
  it("creates browser contexts idempotently", () => {
    ensureBrowserContexts();
    ensureBrowserContexts();

    const contexts = getDb().prepare("SELECT platform, status FROM browser_contexts ORDER BY platform").all();
    expect(contexts).toHaveLength(4);
    expect(contexts.map((context) => context.platform)).toEqual(["discord", "linkedin", "reddit", "x"]);
    expect(contexts.every((context) => context.status === "needs_login")).toBe(true);
  });

  it("creates queued runs with an initial visible step", () => {
    const runId = createRun({
      kind: "research",
      prompt: "Find infra founders",
      platforms: ["web", "linkedin"]
    });

    expect(listRuns(10).map((run) => run.id)).toContain(runId);
    const detail = getRunDetail(runId);
    expect(detail.run?.status).toBe("queued");
    expect(detail.steps).toHaveLength(1);
    expect(detail.steps[0].title).toBe("Run queued");
  });

  it("deletes runs", () => {
    const runId = createRun({
      kind: "research",
      prompt: "Delete me",
      platforms: ["web"]
    });

    expect(deleteRun(runId)).toBe(true);
    expect(listRuns(10).some((run) => run.id === runId)).toBe(false);
  });

  it("deletes lists without deleting targets", () => {
    const now = Date.now();
    const db = getDb();
    db.prepare("INSERT INTO runs (id, kind, status, prompt, created_at, updated_at) VALUES ('run_list_delete', 'research', 'completed', 'Find', ?, ?)").run(now, now);
    db.prepare("INSERT INTO lists (id, name, description, source_run_id, created_at, updated_at) VALUES ('list_delete', 'List', 'Desc', 'run_list_delete', ?, ?)").run(now, now);
    db.prepare("INSERT INTO targets (id, run_id, list_id, platform, target_type, display_name, status, created_at, updated_at) VALUES ('target_keep', 'run_list_delete', 'list_delete', 'web', 'company', 'Keep', 'saved', ?, ?)").run(now, now);
    db.prepare("INSERT INTO list_items (id, list_id, target_id, rank, created_at) VALUES ('item_delete', 'list_delete', 'target_keep', 1, ?)").run(now);

    expect(deleteList("list_delete")).toBe(true);
    expect(listLists().some((list) => list.id === "list_delete")).toBe(false);
    expect(db.prepare("SELECT list_id FROM targets WHERE id = 'target_keep'").get()).toEqual({ list_id: null });
  });

  it("groups targets by recent source runs", () => {
    const db = getDb();
    db.prepare("INSERT INTO runs (id, kind, status, prompt, created_at, updated_at) VALUES ('run_old', 'research', 'completed', 'Old run', 1000, 1000)").run();
    db.prepare("INSERT INTO runs (id, kind, status, prompt, created_at, updated_at) VALUES ('run_new', 'research', 'completed', 'New run', 2000, 2000)").run();
    db.prepare("INSERT INTO targets (id, run_id, platform, target_type, display_name, relevance_score, status, created_at, updated_at) VALUES ('target_old', 'run_old', 'web', 'person', 'Old Target', 0.9, 'new', 1100, 1100)").run();
    db.prepare("INSERT INTO targets (id, run_id, platform, target_type, display_name, relevance_score, status, created_at, updated_at) VALUES ('target_new_low', 'run_new', 'web', 'person', 'New Low', 0.2, 'new', 2100, 2100)").run();
    db.prepare("INSERT INTO targets (id, run_id, platform, target_type, display_name, relevance_score, status, created_at, updated_at) VALUES ('target_new_high', 'run_new', 'web', 'person', 'New High', 0.8, 'new', 2200, 2200)").run();

    const grouped = listTargetsByRun(1);

    expect(grouped.map((target) => target.id)).toEqual(["target_new_high", "target_new_low"]);
    expect(grouped.every((target) => target.run_id === "run_new")).toBe(true);
    expect(grouped[0].run_prompt).toBe("New run");
  });

  it("queues target-scoped research runs and surfaces them on target detail", () => {
    const now = Date.now();
    const db = getDb();
    db.prepare("INSERT INTO runs (id, kind, status, prompt, created_at, updated_at) VALUES ('run_source', 'research', 'completed', 'Find', ?, ?)").run(now, now);
    db.prepare(
      `INSERT INTO targets
        (id, run_id, platform, target_type, display_name, handle, profile_url, organization, role_or_context, why_relevant, status, created_at, updated_at)
       VALUES ('target_deep', 'run_source', 'linkedin', 'person', 'Deep Target', 'deep', 'https://example.com/deep', 'Example Org', 'Founder', 'Strong fit', 'new', ?, ?)`
    ).run(now, now);

    const runId = createTargetResearchRun("target_deep");
    expect(runId).toBeTruthy();

    const detail = getTargetDetail("target_deep");
    expect(detail.researchRuns.map((run) => run.id)).toContain(runId);
    const run = getRunDetail(String(runId)).run;
    expect(run?.kind).toBe("research");
    expect(String(run?.prompt)).toContain("Research further on Deep Target");
    expect(JSON.parse(String(run?.settings_json))).toMatchObject({ targetIds: ["target_deep"] });
  });

  it("queues explicit Reddit write actions with a visible audit trail", () => {
    const queued = queueRedditWriteAction({
      actionType: "submit_post",
      subredditName: "reacher_usage_dev",
      title: "Smoke test title",
      text: "Smoke test body",
      runAs: "USER"
    });

    const detail = getRunDetail(queued.runId);
    expect(detail.run?.kind).toBe("reddit_write");
    expect(detail.run?.status).toBe("waiting_for_operator");
    expect(detail.targets).toHaveLength(1);

    const actions = listRedditActions();
    expect(actions).toHaveLength(1);
    expect(actions[0].action_type).toBe("submit_post");
    expect(actions[0].status).toBe("waiting_for_operator");
  });

  it("creates Gmail outreach runs with email targets, drafts, and actions", async () => {
    const result = await createGmailOutreachRun({
      prompt: "Send concise outreach",
      gmailOutreach: {
        draftMode: "template",
        recipientsRaw: "email,name,company,role,notes\nfounder@example.com,Fran Founder,Example Co,CEO,Uses agent tooling",
        subject: "Quick note for {{company}}",
        body: "Hi {{name}},\n\nSaw {{company}} and wanted to compare notes."
      }
    });

    expect(result.validRecipients).toBe(1);
    const detail = getRunDetail(result.runId);
    expect(detail.run?.kind).toBe("outreach_prepare");
    expect(detail.targets[0].platform).toBe("email");
    expect(detail.drafts[0].platform).toBe("email");
    expect(String(detail.drafts[0].body)).toContain("Quick note for Example Co");
    expect(detail.actions[0].action_type).toBe("create_gmail_draft");
    expect(listRunsByMode("outreach", 10).map((run) => run.id)).toContain(result.runId);
  });

  it("stores and disconnects Gmail OAuth integration state", () => {
    upsertGmailIntegration({
      accountLabel: "Avi",
      accountEmail: "avi@example.com",
      scopes: "openid email profile https://www.googleapis.com/auth/gmail.compose",
      accessToken: "access-token",
      refreshToken: "refresh-token",
      expiresAt: Date.now() + 3600_000
    });

    const connected = getGmailIntegration();
    expect(connected?.account_email).toBe("avi@example.com");
    expect(connected?.refresh_token).toBe("refresh-token");

    disconnectGmailIntegration();
    expect(getGmailIntegration()).toBeUndefined();
  });
});
