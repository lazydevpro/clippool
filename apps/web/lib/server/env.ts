import "server-only";
import fs from "node:fs";
import path from "node:path";
import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import type { ChainKey } from "@/lib/shared/chain";

/**
 * Server env access. Nothing here throws at import time: every getter validates lazily and throws
 * a MissingEnvError naming the variable (never its value) when a route needs something missing.
 *
 * The repo keeps a single root `.env` (Next only auto-loads `apps/web/.env*`), so on first access we
 * load the nearest `.env` walking up from cwd without overriding variables already set (Vercel).
 */

export class MissingEnvError extends Error {
  readonly variable: string;
  constructor(variable: string, detail = "is not set") {
    super(`Environment variable ${variable} ${detail}`);
    this.name = "MissingEnvError";
    this.variable = variable;
  }
}

let loaded = false;
function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  if (process.env.VITEST || process.env.CLIPPOOL_SKIP_DOTENV) return; // tests never read real secrets
  let dir = process.cwd();
  for (let i = 0; i < 4; i++) {
    const file = path.join(dir, ".env");
    if (fs.existsSync(file)) {
      loadDotenv({ path: file, override: false, quiet: true });
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

function raw(name: string): string | undefined {
  ensureLoaded();
  const v = process.env[name];
  return v === undefined || v.trim() === "" ? undefined : v.trim();
}

function required<T>(name: string, schema: z.ZodType<T>): T {
  const v = raw(name);
  if (v === undefined) throw new MissingEnvError(name);
  const parsed = schema.safeParse(v);
  if (!parsed.success) throw new MissingEnvError(name, "is malformed");
  return parsed.data;
}

function optional<T>(name: string, schema: z.ZodType<T>): T | undefined {
  const v = raw(name);
  if (v === undefined) return undefined;
  const parsed = schema.safeParse(v);
  if (!parsed.success) throw new MissingEnvError(name, "is malformed");
  return parsed.data;
}

const url = z.url();
const hex32 = z.string().regex(/^0x[0-9a-fA-F]{64}$/).transform((s) => s as `0x${string}`);
const address = z.string().regex(/^0x[0-9a-fA-F]{40}$/).transform((s) => s as `0x${string}`);
const chainKeySchema = z.enum(["arc", "arcTestnet"]);
const blockNumber = z.string().regex(/^\d+$/).transform((s) => BigInt(s));

export const env = {
  chainKey(): ChainKey {
    return optional("NEXT_PUBLIC_CHAIN", chainKeySchema) ?? "arcTestnet";
  },
  rpcUrl(): string {
    const key = env.chainKey();
    const name = key === "arc" ? "ARC_MAINNET_RPC_URL" : "ARC_TESTNET_RPC_URL";
    return required(name, url);
  },
  clipPoolAddress(): `0x${string}` {
    return required("NEXT_PUBLIC_CLIPPOOL_ADDRESS", address);
  },
  /** Required for the indexer: scanning Arc from genesis in 10k-block pages would never catch up. */
  deployBlock(): bigint {
    return required("NEXT_PUBLIC_CLIPPOOL_DEPLOY_BLOCK", blockNumber);
  },
  oraclePrivateKey(): `0x${string}` {
    return required("ORACLE_PRIVATE_KEY", hex32);
  },
  keeperPrivateKey(): `0x${string}` {
    return required("KEEPER_PRIVATE_KEY", hex32);
  },
  youtubeApiKey(): string {
    return required("YOUTUBE_API_KEY", z.string().min(10));
  },
  databaseUrl(): string {
    return required("DATABASE_URL", url);
  },
  circleApiKey(): string {
    return required("CIRCLE_API_KEY", z.string().min(10));
  },
  /** Public OAuth client id (Web). The backend checks Google access tokens were minted for it. */
  googleClientId(): string {
    return required("NEXT_PUBLIC_GOOGLE_CLIENT_ID", z.string().min(10));
  },
  cronSecret(): string {
    return required("CRON_SECRET", z.string().min(16));
  },
} as const;

/** Test hook: forget the "already loaded" flag. */
export function __resetEnvForTests() {
  loaded = false;
}
