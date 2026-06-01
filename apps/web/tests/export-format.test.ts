import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDb, resetDbForTests } from "../lib/db/client";
import { runCsv, runJson, runMarkdown } from "../lib/exports/format";

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
  tempDir = mkdtempSync(join(tmpdir(), "reacher-export-test-"));
  const dbPath = join(tempDir, "reacher.sqlite");
  applyMigration(dbPath);
  process.env.DATABASE_URL = `file:${dbPath}`;
  resetDbForTests();

  const now = Date.now();
  const db = getDb();
  db.prepare("INSERT INTO runs (id, kind, status, prompt, interpreted_goal, created_at, updated_at) VALUES ('run_test', 'research', 'completed', 'Find careful targets', 'Find evidence-backed targets', ?, ?)").run(now, now);
  db.prepare("INSERT INTO research_filters (id, run_id, platform, kind, value, reason, confidence, created_at) VALUES ('filter_test', 'run_test', 'reddit', 'keyword', 'r/SaaS + outbound', 'High-intent discussion', 0.8, ?)").run(now);
  db.prepare("INSERT INTO sources (id, run_id, platform, source_type, url, title, summary, captured_at) VALUES ('source_test', 'run_test', 'reddit', 'post', 'https://example.com/source', 'Source', 'Summary', ?)").run(now);
  db.prepare("INSERT INTO targets (id, run_id, platform, target_type, display_name, handle, profile_url, relevance_score, why_relevant, status, created_at, updated_at) VALUES ('target_test', 'run_test', 'reddit', 'person', 'A Target', 'target', 'https://example.com/profile', 0.9, 'Strong evidence', 'saved', ?, ?)").run(now, now);
  db.prepare("INSERT INTO run_usage_events (id, run_id, provider, service, operation, model, quantity, unit, unit_cost_usd, estimated_cost_usd, input_tokens, output_tokens, total_tokens, cost_basis, created_at) VALUES ('usage_test', 'run_test', 'gemini-cli', 'llm', 'generate_content', 'gemini-2.5-flash', 300, 'token', NULL, 0.001, 200, 100, 300, 'estimated_tokens', ?)").run(now);
});

afterEach(() => {
  resetDbForTests();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("export formatting", () => {
  it("includes filters and target evidence summary in markdown", () => {
    const markdown = runMarkdown("run_test");
    expect(markdown).toContain("| reddit | r/SaaS + outbound | High-intent discussion |");
    expect(markdown).toContain("### A Target");
    expect(markdown).toContain("- Targets found: 1");
    expect(markdown).toContain("- Estimated usage cost: $0.0010");
    expect(markdown).toContain("| gemini-cli | llm | 300 | token | 300 | $0.0010 |");
  });

  it("creates stable csv and json outputs", () => {
    expect(runCsv("run_test").split("\n")[0]).toContain("estimated_run_cost_usd");
    const json = JSON.parse(runJson("run_test")) as { targets: unknown[]; filters: unknown[]; usage_summary: { estimated_cost_usd: number } };
    expect(json.targets).toHaveLength(1);
    expect(json.filters).toHaveLength(1);
    expect(json.usage_summary.estimated_cost_usd).toBe(0.001);
  });
});
