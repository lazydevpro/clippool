# ClipPool

Pro-rata creator campaigns on Arc (Circle's L1): brands lock USDC/EURC, creators post YouTube Shorts,
the pool is split by views and paid instantly on Arc.

- Spec: `docs/plans/2026-10-12-clippool-spec.md` · Plan: `docs/plans/2026-10-12-clippool-plan.md`
- **Shared interfaces (ABI, allocation algorithm, fixtures, file ownership): `docs/plans/interfaces.md`** — follow it exactly.
- Tasks: `TODO.md` (check off items as they land).

## Layout
- `contracts/` Foundry (Solidity ^0.8.24, OpenZeppelin). Arc Foundry (`arc-forge`) for Arc fork tests when installed; plain `forge` otherwise.
- `packages/allocation/` TypeScript allocation engine + Merkle tree + CLI (vitest).
- `apps/web/` Next.js 16 (App Router) — read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` before writing Next code. shadcn/ui, wagmi/viem, Circle user-controlled wallets, Drizzle + Neon.

## Rules
- Package manager: pnpm workspace. Deps are pre-installed; avoid adding new ones.
- Env: single root `.env` (see `.env.example`). Never print or commit secret values.
- Arc gotchas: USDC ERC-20 is 6 decimals (native is 18 — never mix); `maxFeePerGas ≥ 20 gwei`; transfers to `address(0)` and blocklisted addresses revert; `eth_getLogs` ≤ 10k blocks.
- No raw YouTube statistics onchain (YouTube API policy: ≤30 days storage).
- Mainnet transactions that move funds (deploy, fund campaigns, payouts) are run by the user, not by agents.
- Done = typecheck + tests pass and behaviour verified, not "should work".
