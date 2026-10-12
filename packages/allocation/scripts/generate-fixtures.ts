/**
 * Writes golden fixtures to contracts/test/fixtures/allocation-<name>.json (interfaces.md §4)
 * and an example snapshot to packages/allocation/examples/. Deterministic: re-running produces
 * byte-identical files. `--check` exits 1 if anything on disk differs instead of writing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { generatedFiles } from "./fixture-cases";

const check = process.argv.includes("--check");
let changed = 0;
for (const [path, contents] of generatedFiles()) {
  const current = existsSync(path) ? readFileSync(path, "utf8") : null;
  const status = current === null ? "created" : current === contents ? "unchanged" : "updated";
  if (status !== "unchanged") changed++;
  if (!check && status !== "unchanged") {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
  }
  console.log(`${check && status !== "unchanged" ? "DRIFT" : status.padEnd(9)} ${relative(process.cwd(), path)}`);
}
if (check && changed > 0) {
  console.error(`${changed} file(s) out of date; run \`pnpm --filter @clippool/allocation fixtures\``);
  process.exit(1);
}
