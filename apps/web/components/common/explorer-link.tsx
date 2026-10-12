import { ExternalLinkIcon } from "lucide-react";
import { explorerTx } from "@/lib/shared/chain";
import { shortHash } from "@/lib/client/format";
import { cn } from "@/lib/utils";

export function TxLink({ hash, label, className }: { hash: string; label?: string; className?: string }) {
  return (
    <a
      href={explorerTx(hash)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "inline-flex items-center gap-1 font-mono text-[0.85em] text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none dark:text-brand-soft",
        className,
      )}
      title={hash}
    >
      {label ?? shortHash(hash)}
      <ExternalLinkIcon className="size-3" aria-hidden />
      <span className="sr-only">(opens the Arc explorer)</span>
    </a>
  );
}
