import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const root = resolve(import.meta.dirname, "../../..");
const databaseUrl = process.env.DATABASE_URL ?? "file:./data/reacher.sqlite";
const databasePath = databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : databaseUrl;
const absoluteDatabasePath = resolve(root, databasePath);
const migrationsDir = resolve(root, "apps/web/db/migrations");

mkdirSync(dirname(absoluteDatabasePath), { recursive: true });

const db = new DatabaseSync(absoluteDatabasePath);
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");
db.exec("PRAGMA busy_timeout = 5000;");
db.exec("CREATE TABLE IF NOT EXISTS __drizzle_migrations (id TEXT PRIMARY KEY, applied_at INTEGER NOT NULL);");

if (!existsSync(migrationsDir)) {
  throw new Error(`Missing migrations directory: ${migrationsDir}`);
}

const files = readdirSync(migrationsDir).filter((file) => file.endsWith(".sql")).sort();

for (const file of files) {
  const applied = db.prepare("SELECT id FROM __drizzle_migrations WHERE id = ?").get(file);
  if (applied) continue;

  const sql = readFileSync(join(migrationsDir, file), "utf8");
  db.exec("BEGIN;");
  try {
    db.exec(sql);
    db.prepare("INSERT INTO __drizzle_migrations (id, applied_at) VALUES (?, ?)").run(file, Date.now());
    db.exec("COMMIT;");
    console.log(`Applied ${file}`);
  } catch (error) {
    db.exec("ROLLBACK;");
    throw error;
  }
}

console.log(files.length === 0 ? "No migrations found." : "Migrations complete.");
db.close();
