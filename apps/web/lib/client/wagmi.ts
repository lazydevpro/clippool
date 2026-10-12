import { createConfig, http } from "wagmi";
import { injected } from "wagmi/connectors/injected";
import { activeChain } from "@/lib/shared/chain";
import { PUBLIC_RPC_URL } from "./env";

/** Injected wallets only (MetaMask, Rabby, …). EIP-6963 discovery lists each installed wallet. */
export const wagmiConfig = createConfig({
  chains: [activeChain],
  connectors: [injected()],
  transports: { [activeChain.id]: http(PUBLIC_RPC_URL) } as Record<(typeof activeChain)["id"], ReturnType<typeof http>>,
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
