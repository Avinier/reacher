import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

let cached: DatabaseSync | null = null;

export function databasePath() {
  const databaseUrl = process.env.DATABASE_URL ?? "file:./data/reacher.sqlite";
  const rawPath = databaseUrl.startsWith("file:") ? databaseUrl.slice(5) : databaseUrl;
  return resolve(process.cwd().endsWith("apps/web") ? "../.." : ".", rawPath);
}

export function getDb() {
  if (cached) return cached;
  const path = databasePath();
  mkdirSync(dirname(path), { recursive: true });
  cached = new DatabaseSync(path);
  cached.exec("PRAGMA journal_mode = WAL;");
  cached.exec("PRAGMA foreign_keys = ON;");
  cached.exec("PRAGMA busy_timeout = 5000;");
  return cached;
}

export function resetDbForTests() {
  cached?.close();
  cached = null;
}

export function id(prefix: string) {
  return `${prefix}_${crypto.randomUUID().replaceAll("-", "").slice(0, 20)}`;
}
