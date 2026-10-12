import "server-only";
import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { env } from "@/lib/server/env";
import * as schema from "./schema";

export type Db = NeonHttpDatabase<typeof schema>;

let db: Db | undefined;

/** Lazily-created Drizzle client over Neon's HTTP driver (no connection at import time). */
export function getDb(): Db {
  if (!db) db = drizzle({ client: neon(env.databaseUrl()), schema });
  return db;
}

export { schema };
