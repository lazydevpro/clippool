// Distribute testnet USDC from the DEPLOYER wallet to the oracle, keeper and test-brand wallets.
// Usage (from apps/web): pnpm fund:testnet            → show balances + planned transfers
//                         pnpm fund:testnet --send     → send them (Arc testnet only)
import { parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { assertTestnet, clients, fees, native, requireEnv, txUrl } from "./lib";

// Target native balances (18-dp native USDC; same balance as the 6-dp ERC-20 view).
const TARGETS: Record<string, bigint> = {
  ORACLE_PRIVATE_KEY: parseEther("0.5"),
  KEEPER_PRIVATE_KEY: parseEther("0.5"),
  TEST_BRAND_PRIVATE_KEY: parseEther("6"),
};
const DEPLOYER_RESERVE = parseEther("0.5");

async function main() {
  const send = process.argv.includes("--send");
  const { publicClient, wallet } = clients();
  await assertTestnet(publicClient);

  const deployer = wallet("DEPLOYER_PRIVATE_KEY");
  const deployerBal = await publicClient.getBalance({ address: deployer.account.address });
  console.log(`DEPLOYER    ${deployer.account.address}  ${native(deployerBal)}`);

  const plan: { role: string; to: Address; amount: bigint }[] = [];
  for (const [role, target] of Object.entries(TARGETS)) {
    const to = privateKeyToAccount(requireEnv(role) as `0x${string}`).address;
    const bal = await publicClient.getBalance({ address: to });
    console.log(`${role.replace("_PRIVATE_KEY", "").padEnd(11)} ${to}  ${native(bal)}`);
    if (bal < target) plan.push({ role, to, amount: target - bal });
  }

  const needed = plan.reduce((s, p) => s + p.amount, 0n) + DEPLOYER_RESERVE;
  if (plan.length === 0) return console.log("\n✓ All wallets already funded.");
  console.log(`\nPlanned: ${plan.map((p) => `${p.role.replace("_PRIVATE_KEY", "")} +${native(p.amount)}`).join(", ")}`);
  if (deployerBal < needed) {
    throw new Error(`Deployer needs ≥ ${native(needed)} (has ${native(deployerBal)}). Request more from faucet.circle.com (Arc Testnet).`);
  }
  if (!send) return console.log("Dry run. Re-run with --send to transfer.");

  for (const p of plan) {
    const hash = await deployer.sendTransaction({ to: p.to, value: p.amount, ...(await fees(publicClient)) });
    await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✓ ${p.role.replace("_PRIVATE_KEY", "")} +${native(p.amount)}  ${txUrl(hash)}`);
  }
}

main().catch((e) => {
  console.error(`✗ ${e instanceof Error ? e.message : e}`);
  process.exit(1);
});
