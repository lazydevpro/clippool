import Link from "next/link";
import { EXPLORER_URL, chainKey, explorerAddress } from "@/lib/shared/chain";
import { CHAIN_NAME, CLIPPOOL } from "@/lib/client/env";
import { LogoMark } from "@/components/common/logo";

export function SiteFooter() {
  return (
    <footer className="mt-24 border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-10 text-sm text-muted-foreground sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="flex items-center gap-3">
          <LogoMark className="size-6" />
          <p>
            <span className="font-medium text-foreground">Built on Arc.</span> Pools escrowed onchain, paid out in
            USDC/EURC on {CHAIN_NAME}.
          </p>
        </div>
        <nav aria-label="Footer" className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <Link href="/campaigns/new" className="hover:text-foreground">
            Launch a campaign
          </Link>
          <Link href="/me" className="hover:text-foreground">
            Creator dashboard
          </Link>
          <a href={EXPLORER_URL[chainKey]} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
            Arc explorer
          </a>
          {CLIPPOOL ? (
            <a href={explorerAddress(CLIPPOOL)} target="_blank" rel="noopener noreferrer" className="hover:text-foreground">
              ClipPool contract
            </a>
          ) : (
            <span title="Set NEXT_PUBLIC_CLIPPOOL_ADDRESS after deploy">Contract: not deployed</span>
          )}
        </nav>
      </div>
    </footer>
  );
}
