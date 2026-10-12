"use client";

import { ExternalLinkIcon } from "lucide-react";
import { explorerAddress } from "@/lib/shared/chain";
import { shortAddress } from "@/lib/client/format";
import { cn } from "@/lib/utils";
import { CopyButton } from "./copy-button";

/** Short address with copy + explorer link. Full address is in the title for hover. */
export function Address({
  address,
  className,
  explorer = true,
  copy = true,
  full = false,
}: {
  address: string;
  className?: string;
  explorer?: boolean;
  copy?: boolean;
  full?: boolean;
}) {
  return (
    <span className={cn("inline-flex items-center gap-0.5 font-mono text-[0.85em]", className)}>
      <span title={address} className={cn(full && "break-all")}>
        {full ? address : shortAddress(address)}
      </span>
      {copy && <CopyButton value={address} label="Copy address" toastLabel="Address copied" />}
      {explorer && (
        <a
          href={explorerAddress(address)}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex size-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="View address on the Arc explorer"
        >
          <ExternalLinkIcon className="size-3" aria-hidden />
        </a>
      )}
    </span>
  );
}
