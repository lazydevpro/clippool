#!/usr/bin/env bash
# Point production (https://clippool.fun) at Arc MAINNET. YOU run this — it uploads mainnet secrets to Vercel.
# Reads .env.mainnet (keys, DB, Circle LIVE) + contracts/deployments/5042.json. Asks for confirmation.
# --without-circle : switch without Circle LIVE keys (Google wallet sign-in hidden; paste-a-wallet + Connect YouTube still work)
set -euo pipefail
WITHOUT_CIRCLE=0; [ "${1:-}" = "--without-circle" ] && WITHOUT_CIRCLE=1
export WITHOUT_CIRCLE
TMP=/tmp/clippool-mainnet-env.json
trap 'rm -f "$TMP"' EXIT INT TERM   # never leave mainnet secrets on disk
cd "$(dirname "$0")/.."
DEP=contracts/deployments/5042.json
[ -f "$DEP" ] || { echo "Deploy first (scripts/deploy-mainnet.sh)"; exit 1; }
node - <<'JS' > /tmp/clippool-mainnet-env.json
const fs = require("fs");
const env = require("./apps/web/node_modules/dotenv").parse(fs.readFileSync(".env.mainnet"));
const d = JSON.parse(fs.readFileSync("contracts/deployments/5042.json", "utf8"));
const noCircle = process.env.WITHOUT_CIRCLE === "1";
const need = ["ORACLE_PRIVATE_KEY", "KEEPER_PRIVATE_KEY", "DATABASE_URL", ...(noCircle ? [] : ["CIRCLE_API_KEY_LIVE", "NEXT_PUBLIC_CIRCLE_APP_ID_LIVE"])];
const missing = need.filter((k) => !(env[k] || "").trim());
if (missing.length) { console.error("Missing in .env.mainnet: " + missing.join(", ")); process.exit(1); }
const out = {
  NEXT_PUBLIC_CHAIN: "arc",
  NEXT_PUBLIC_APP_URL: "https://clippool.fun",
  NEXT_PUBLIC_ARC_RPC_URL: "https://rpc.mainnet.arc.io",
  NEXT_PUBLIC_CLIPPOOL_ADDRESS: d.address,
  NEXT_PUBLIC_CLIPPOOL_DEPLOY_BLOCK: String(d.deployBlock),
  ORACLE_PRIVATE_KEY: env.ORACLE_PRIVATE_KEY.trim(),
  KEEPER_PRIVATE_KEY: env.KEEPER_PRIVATE_KEY.trim(),
  DATABASE_URL: env.DATABASE_URL.trim(),
};
if (!noCircle) {
  out.NEXT_PUBLIC_CIRCLE_APP_ID = env.NEXT_PUBLIC_CIRCLE_APP_ID_LIVE.trim();
  out.CIRCLE_API_KEY = env.CIRCLE_API_KEY_LIVE.trim();
}
process.stdout.write(JSON.stringify(out));
JS
chmod 600 /tmp/clippool-mainnet-env.json
[ "$WITHOUT_CIRCLE" = "1" ] && echo "Mode: WITHOUT Circle (Google wallet sign-in hidden on mainnet)"
echo "Will set on Vercel (production): $(node -e 'console.log(Object.keys(require("/tmp/clippool-mainnet-env.json")).join(", "))')"
echo "Contract: $(node -e 'console.log(require("./'"$DEP"'").address)')"
read -r -p "Type SWITCH to update Vercel and redeploy production: " ok; [ "$ok" = "SWITCH" ] || { rm -f /tmp/clippool-mainnet-env.json; echo "aborted"; exit 1; }
node -e '
const {spawnSync}=require("child_process"); const env=require("/tmp/clippool-mainnet-env.json");
const secret=new Set(["ORACLE_PRIVATE_KEY","KEEPER_PRIVATE_KEY","DATABASE_URL","CIRCLE_API_KEY"]);
for (const [k,v] of Object.entries(env)) {
  const args=["--yes","vercel@latest","env","add",k,"production","--force"]; if (secret.has(k)) args.push("--sensitive");
  const r=spawnSync("npx",args,{input:v,encoding:"utf8"}); console.log((r.status===0?"✓ ":"✗ ")+k);
  if (r.status!==0) process.exit(1);
}'
rm -f /tmp/clippool-mainnet-env.json
if [ "$WITHOUT_CIRCLE" = "1" ]; then
  # testnet Circle keys can't create mainnet wallets → remove them so the Google option is hidden
  for k in NEXT_PUBLIC_CIRCLE_APP_ID CIRCLE_API_KEY; do npx --yes vercel@latest env rm "$k" production --yes >/dev/null 2>&1 && echo "✓ removed $k (Circle sign-in hidden)" || echo "• $k not set"; done
fi
npx --yes vercel@latest deploy --prod --yes >/dev/null && echo "✓ Production redeployed on mainnet → https://clippool.fun"
