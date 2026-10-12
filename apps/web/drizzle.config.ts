import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { defineConfig } from "drizzle-kit";

// Single root .env for the monorepo; fall back to a local one.
for (const p of [path.resolve(__dirname, "../../.env"), path.resolve(__dirname, ".env")]) {
  if (fs.existsSync(p)) {
    loadDotenv({ path: p, override: false, quiet: true });
    break;
  }
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema.ts",
  out: "./lib/db/migrations",
  // Migrations need a direct (unpooled) connection. `generate` does not connect at all.
  dbCredentials: { url: process.env.DATABASE_URL_UNPOOLED ?? "" },
  strict: true,
  verbose: true,
});
