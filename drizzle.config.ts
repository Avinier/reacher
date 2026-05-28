import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./apps/web/db/schema/index.ts",
  out: "./apps/web/db/migrations",
  dialect: "sqlite",
  dbCredentials: {
    url: "./data/reacher.sqlite"
  }
});
