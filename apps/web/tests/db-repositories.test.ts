import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRun, ensureBrowserContexts, getRunDetail, listRedditActions, listRuns, queueRedditWriteAction } from "../lib/db/repositories";
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
