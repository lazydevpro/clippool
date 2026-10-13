# TODO — ClipPool (Arc Microgrants)

Spec: [docs/plans/2026-10-12-clippool-spec.md](docs/plans/2026-10-12-clippool-spec.md) ·
Plan: [docs/plans/2026-10-12-clippool-plan.md](docs/plans/2026-10-12-clippool-plan.md)

## Now
- [x] Spec §10 decisions: defaults accepted (0% fee, refund cap overflow, single snapshot, Next/Vercel/Neon, name TBD) #spec
- [x] Phase 0: pnpm monorepo, Next.js 16 + shadcn + deps, shared ABI/API types, .env.example, git init #setup
- [x] Phase 0: Arc Foundry v0.8.0-2 installed (~/.local/bin, sha256 verified) + libusb #setup
- [ ] Phase 0 (user): fill `.env` — see `.env.example` legend [T] for testnet E2E #setup
- [x] Phase 1: `ClipPool.sol` + 70 tests (unit/fuzz/invariant/10 fixtures), 100% line coverage #contracts
- [x] Phase 1: Arc fork tests — real USDC permit/dual-interface + EURC, pass on testnet & mainnet forks (`arc-forge test --match-contract Fork --fork-url …`) #contracts
- [x] Phase 2: allocation engine + CLI + 10 golden fixtures (565 tests green) #allocation
- [x] Phase 4: backend — DB schema+migration, YouTube validation, oracle, keeper, 15 API routes, Circle (117 tests) #backend
- [x] Cron via GitHub Actions (.github/workflows/cron.yml; secrets APP_URL + CRON_SECRET) #backend
- [ ] Purge/refresh stored YouTube titles+thumbnails within 30 days (stats already purged) #backend #compliance
- [ ] Sign /meta with brand wallet (currently first-write-wins; rules pinned by hash) #backend
- [x] Phase 5: frontend — landing, create (permit), campaign, submit, receipts, /me, Circle login; mock mode #web

- [x] Integration: cross-language fixtures (10/10), binding-code parity test, Next 16 prerender fixes, clean build #integration
- [x] CI workflow (.github/workflows/ci.yml: forge test, allocation tests + fixture drift check, web typecheck/lint/test/build) #setup
- [x] DISPUTE_WINDOW / MIN_MEASUREMENT_DELAY as deploy-time immutables (mainnet 48h/1h, testnet 10min/5min); web reads them from the contract (`disputeWindow` API field, 5-min testnet preset) #contracts #web

## Next
- [x] Phase 3: ClipPool deployed + verified on Arc testnet `0x50519aFfe82591afd402c7F22ad9BC6DD2d86030` (10 min / 5 min windows); wallets funded #e2e
- [x] Phase 3: scripted E2E PASSED on testnet — campaign #1: permit create → root → claimMany (3 creators, ≈0.0048 USDC gas) → refund; `verify` CLI PASS vs onchain root #e2e
- [x] Phase 3b: full-stack E2E PASSED — campaign #2: real Short (10 views) → oracle cron posted root → keeper cron paid 2 USDC to creator's Circle wallet; `verify` CLI PASS #e2e
- [x] Connect YouTube (OAuth youtube.readonly, channel ownership) as main submission path; binding code as fallback — migration 0001_youtube_oauth applied to dev DB #web #backend
- [ ] (user) Google Cloud: add youtube.readonly scope to consent screen, JS origins, test users — then test the real popup on /c/2/submit #setup
- [ ] Google OAuth app verification for youtube.readonly before public launch (testing mode ≤100 users until then) #launch
- [ ] `GET /api/wallets/:address/campaigns` for /me (currently scans leaderboards client-side) #backend
- [x] Circle Google login uses one fixed callback `/auth/callback` (returns to origin page) — register `<origin>/auth/callback` per environment #web

## Launch
- [x] Public repo https://github.com/lazydevpro/clippool · CI green
- [x] Vercel production https://clippool.fun (testnet config) · GitHub Actions cron → /api/cron/* HTTP 200
- [ ] Google OAuth: add https://clippool.fun origin + /auth/callback redirect (user)
- [ ] Reliable scheduler: GitHub `schedule` hasn't fired on the new repo (manual dispatch works) → add Cloudflare Worker cron or cron-job.org hitting /api/cron/* as primary/backup #backend
- [x] Mainnet prep: operator keys in .env.mainnet, Neon `mainnet` branch (empty, migrated), deploy dry-run OK (48h/1h, ≈0.13 USDC gas), scripts/deploy-mainnet.sh + scripts/switch-vercel-mainnet.sh #launch
- [x] Mainnet: operators funded; ClipPool deployed 0xDb224b1b1dA608d51d5D6D5C492d083c80F2Dfb9 (48h/1h, guardian = user wallet), Sourcify exact_match, explorer verified #launch
- [x] Production on Arc mainnet at https://clippool.fun (switch --without-circle; sync from deploy block caught up) #launch
- [ ] Circle LIVE App ID (needs Circle billing) → rerun switch script without the flag to enable Google wallets on mainnet #launch
- [ ] Mainnet pilot campaign (user) #launch (user runs fund-moving steps)

## Later
- [ ] Phase 6: mainnet deploy + verify + pilot campaign #launch
- [x] Phase 7a: README + demo video (https://youtu.be/6AJOfA3wmtU) + YouTube thumbnail #launch
- [ ] Phase 7b: DoraHacks submission after mainnet deploy (user submits) #launch
- [ ] MetaMask/Blockaid flags clippool.fun as malicious on permit → report false positive + consider custom domain before mainnet #launch
- [ ] v2: zkTLS engaged views, TikTok/IG, per-video windows #v2

## Done
- [x] Idea research + EURC gas feasibility (docs/research/2026-10-12-eurc-gas-feasibility.md) #research
- [x] Spec + plan drafted #spec
