import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname),
      // `server-only` throws outside the react-server condition; tests run server code directly.
      "server-only": path.resolve(__dirname, "test/server/helpers/server-only.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    env: { CLIPPOOL_SKIP_DOTENV: "1" },
  },
});
