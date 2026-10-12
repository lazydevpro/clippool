"use client";

import { TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { useConnection, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import { useMounted } from "@/hooks/use-mounted";
import { activeChain } from "@/lib/shared/chain";
import { humanizeError } from "@/lib/client/errors";

/** Site-wide prompt when the connected wallet is on another network. */
export function NetworkBanner() {
  const mounted = useMounted();
  const { isConnected, chainId } = useConnection();
  const switchChain = useSwitchChain();
  if (!mounted || !isConnected || chainId === activeChain.id) return null;
  return (
    <div role="status" className="border-b border-warning/30 bg-warning/10">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-4 py-2 text-sm sm:px-6">
        <p className="flex items-center gap-2 text-foreground">
          <TriangleAlertIcon className="size-4 text-warning" aria-hidden />
          Your wallet is on another network. ClipPool runs on <strong>{activeChain.name}</strong>.
        </p>
        <Button
          size="sm"
          variant="outline"
          disabled={switchChain.isPending}
          onClick={() => switchChain.mutate({ chainId: activeChain.id }, { onError: (e) => toast.error(humanizeError(e)) })}
        >
          {switchChain.isPending ? "Switching…" : `Switch to ${activeChain.name}`}
        </Button>
      </div>
    </div>
  );
}
