import path from "node:path";
import { config as loadDotenv } from "dotenv";
import type { NextConfig } from "next";

// The monorepo keeps a single root `.env`; Next only auto-loads `apps/web/.env*`. Load the root file
// here so NEXT_PUBLIC_* values are inlined into the client bundle. Never overrides variables that are
// already set (CLI / Vercel env wins).
loadDotenv({ path: path.resolve(process.cwd(), "../../.env"), override: false, quiet: true });

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
