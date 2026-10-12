# EURC-for-gas on Arc — feasibility research

Date: 2026-10-12 · Context: Arc Microgrants (DoraHacks) idea validation.
All numbers read from Arc mainnet (chain 5042) via `rpc.mainnet.arc.io` and `explorer.arc.io` (Blockscout) on this date.

## 1. Account abstraction on Arc mainnet — live and heavily used

| Contract | Address | Status |
|---|---|---|
| EntryPoint v0.6 | `0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789` | deployed, ~16k bundle txs |
| EntryPoint v0.7 | `0x0000000071727De22E5E9d8BAf0edAc6f37da032` | deployed, ~712k bundle txs |
| EntryPoint v0.8 | `0x4337084D9E255Ff0702461CF8895CE9E3b5Ff108` | deployed, ~458k bundle txs |
| EntryPoint v0.9 | `0x433709009B8330FDa32311DF1C2AFA402eD8D009` | deployed, ~unused |
| Permit2 | `0x000000000022D473030F116dDEE9F6B43aC78BA3` | deployed |

- Bundlers: Pimlico (v0.6–v0.9, EIP-7702 ✅), Alchemy (bundler + sponsorship + **ERC-20 gas payments ✅ on Arc Mainnet**).
- Active paymasters (Blockscout AA indexer): top ones are all **sponsorship** (app pays), sampled ops all `paymaster_sponsor`. Pimlico singletons `0x6666…`, `0x7777…`, `0x8888…` sampled in verifying mode.

## 2. Competitive check — who already offers "pay gas in EURC" on Arc

| Provider | EURC gas on Arc? | Notes |
|---|---|---|
| Circle Paymaster | ❌ | USDC-only; not deployed on Arc (Arb/Avax/Base/Eth/OP/Polygon/Unichain) |
| Pimlico ERC-20 paymaster | ❌ (per public docs) | Supports EURC on Ethereum, Base, Avalanche — Arc absent from token list. Their singleton paymaster *is* on Arc, so adding it is trivial for them. |
| Alchemy Gas Manager | ⚠️ possible | "ERC20 Gas Payments ✅" on Arc Mainnet; custom tokens configurable per app policy. Requires Alchemy account + smart wallets; billed via invoice. Doesn't help a plain EOA (MetaMask) user. |

**Conclusion:** the *capability* exists for apps that integrate Alchemy smart wallets. What does **not** exist: a permissionless, open, onchain way for a **plain EOA** holding only EURC to get gas.

## 3. Demand — are EURC/cirBTC holders actually stranded?

Token stats (explorer):

| Token | Holders | Supply | Transfers |
|---|---|---|---|
| USDC | 1,141,941 | ~508M | 50.8M |
| EURC | 71,478 | ~€6.18M | 540k (~10k/day) |
| cirBTC | 5,929 | ~5,324 BTC | 870k |
| WETH | 1,837 | ~3,710 ETH | 251k |
| USYC | 0 | 0 | 6 |

Stranded check (native USDC balance + nonce via RPC):

- **Recent EURC/cirBTC recipients** (last ~40 min, 60 + 31 EOAs): 0 with zero USDC → active traders are fine.
- **Top ~100 EURC EOA holders**: **19 have < $0.01 USDC; 18 of those have nonce 0** (never sent a tx). Hold ~€12.8k EURC combined (largest €8,162).
  - Inbound source of sampled stuck wallets: **Relay (`RelayRouterV3` 0xb92fe925…)** and **Across (`MulticallHandler.fillRelay`)** cross-chain fills → users bridged EURC *into* Arc and arrived without gas.
- **Top 60 cirBTC EOA holders**: only 1 stuck → cirBTC is **not** a stranding problem. Drop from MVP.

## 4. Pricing & liquidity

Official Chainlink feeds on Arc mainnet (from `reference-data-directory.vercel.app/feeds-arc-mainnet.json`):

| Feed | Proxy | Heartbeat / deviation |
|---|---|---|
| EURC / USD | `0x361b95c10b76Ca3f35C686d423e43A951755Bf23` | 24h / 0.5% |
| EUR / USD | `0xDd5B15443cd733D3966a50a3E48cB7DF9Fb5DE0D` | 24h / 0.5% |
| USDC / USD | `0x84EA90AC252Dc437031461836DB5164219147905` | 24h / 0.5% |
| BTC / USD | `0xa109B535C70C8Be9995be64Bb6751AcDB27e03De` | 24h / 0.5% |
| cirBTC Reserves (PoR) | `0xEB0884a871ea1f6483B5FC10fd3D7dC5806411fc` | 24h / 0.5% |

⚠️ Other verified `EACAggregatorProxy` contracts on the explorer with the same descriptions (e.g. `0x4c39AF…` BTC/USD, `0x71B030…` EURC/USD, `0x0C9264…` USDC/USD) are **not** in Chainlink's official list — don't use them.

Pyth: listed for Arc **testnet** only; the address on mainnet is an unrelated `ReceiverSetup` contract.

Liquidity for EURC→USDC rebalancing:
- App Kit Swap on Arc supports USDC/EURC/cirBTC only; provider fee 2 bps; optional Circle API key (shared rate limit without).
- Onchain: CLPool `0xbe080aC3…` (~€307k EURC), CLPool `0xb88C08E3…` (~€88k), Uniswap v4 PoolManager `0x8366a39C…` (~€92k), UniswapV3Pool `0x6fd5F2fb…` (~€49k).

## 5. EURC token capabilities (Arc mainnet `0xbEf5f6d51CB62b58e6A8f77868681825C6fe21c1`)

- FiatToken `version() = "2"`, `DOMAIN_SEPARATOR` present.
- **EIP-2612 `permit`** ✅ (`nonces()` responds)
- **EIP-3009 `transferWithAuthorization` / `receiveWithAuthorization`** ✅ (`authorizationState()` + typehash respond)

→ A zero-USDC EOA can sign an EIP-3009 authorization offline; a station contract calls `receiveWithAuthorization` and pays native USDC back **in the same tx**, priced by Chainlink. No smart account, no bundler.

## 6. Gas cost reference

Explorer gas price (slow/avg/fast): 20.1 / 22.3 / 34.6 gwei. ERC-20 transfer ≈ 65k gas ≈ $0.0014. A €0.10 top-up ≈ 70 transfers.

## Open risks

- Small absolute stranded value today (~€12.8k in top-100 sample); grows with EURC bridge inflows.
- Pimlico could enable EURC on Arc quickly; Relay/Across could add "gas on arrival" for Arc routes.
- Station must hold USDC inventory; EURC/USD feed has 24h heartbeat → quote with a spread/staleness guard.
