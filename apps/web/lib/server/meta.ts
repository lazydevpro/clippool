import { keccak256, stringToBytes, type Address, type Hex } from "viem";
import type { ChainGateway, OnchainCampaign } from "./chain";
import { HttpError } from "./http";

export const rulesHashOf = (rules: string): Hex => keccak256(stringToBytes(rules));

/**
 * Verify a brand's POST /meta: createTx must be a successful tx sent by the campaign's brand that
 * emitted CampaignCreated(id) on ClipPool, and keccak256(utf8(rules)) must equal the onchain rulesHash.
 * Returns the onchain campaign so the caller can mirror it (no wait for the sync cron).
 */
export async function verifyCampaignMeta(
  chain: Pick<ChainGateway, "getTransaction" | "getCampaign">,
  id: number,
  input: { rules: string; createTx: Hex },
): Promise<{ onchain: OnchainCampaign; brand: Address; createdBlock?: number }> {
  let tx: Awaited<ReturnType<ChainGateway["getTransaction"]>>;
  try {
    tx = await chain.getTransaction(input.createTx);
  } catch {
    throw new HttpError(404, "tx_not_found", "createTx not found (yet) — retry once it is confirmed.");
  }
  if (tx.status !== "success") throw new HttpError(422, "tx_reverted", "createTx reverted.");
  const created = tx.logs.find((l) => l.eventName === "CampaignCreated" && BigInt(l.args.id) === BigInt(id));
  if (!created) throw new HttpError(422, "tx_mismatch", "createTx did not create this campaign.");
  const brand = created.args.brand as Address;
  if (tx.from.toLowerCase() !== brand.toLowerCase()) {
    throw new HttpError(403, "not_brand", "createTx was not sent by the campaign brand.");
  }
  const onchain = await chain.getCampaign(BigInt(id));
  if (rulesHashOf(input.rules).toLowerCase() !== onchain.rulesHash.toLowerCase()) {
    throw new HttpError(422, "rules_hash_mismatch", "keccak256(rules) does not match the onchain rulesHash.");
  }
  return { onchain, brand, createdBlock: Number(created.blockNumber) };
}
