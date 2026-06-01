import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRun, deleteList, deleteRun, ensureBrowserContexts, getRunDetail, listLists, listRedditActions, listRuns, queueRedditWriteAction } from "../lib/db/repositories";
import { getDb, resetDbForTests } from "../lib/db/client";

let tempDir: string;

function applyMigration(dbPath: string) {
  const db = new DatabaseSync(dbPath);
  const migration = readFileSync(resolve(__dirname, "../../../apps/web/db/migrations/0000_square_moon_knight.sql"), "utf8");
  for (const statement of migration.split("--> statement-breakpoint")) {
    const sql = statement.trim();
    if (sql) db.exec(sql);
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
});
