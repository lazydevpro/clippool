"use client";

import { ChevronDownIcon, CopyIcon, ExternalLinkIcon, LogOutIcon, TriangleAlertIcon, WalletIcon } from "lucide-react";
import { toast } from "sonner";
import { useConnect, useConnection, useConnectors, useDisconnect, useSwitchChain } from "wagmi";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useMounted } from "@/hooks/use-mounted";
import { activeChain, explorerAddress } from "@/lib/shared/chain";
import { humanizeError } from "@/lib/client/errors";
import { shortAddress } from "@/lib/client/format";
import { cn } from "@/lib/utils";

function useWalletConnectors() {
  const connectors = useConnectors();
  // Prefer EIP-6963-discovered wallets (MetaMask, Rabby, …); hide the generic one when any exist.
  const discovered = connectors.filter((c) => c.type === "injected" && c.id !== "injected");
  return discovered.length ? discovered : connectors;
}

export function useConnectWallet() {
  const connect = useConnect();
  const connectors = useWalletConnectors();
  const run = (connector = connectors[0]) => {
    if (!connector) return;
    connect.mutate(
      { connector, chainId: activeChain.id },
      {
        onError: (err) => {
          const msg = /provider not found|ProviderNotFound/i.test(String(err?.message ?? err?.name))
            ? "No browser wallet found. Install MetaMask or Rabby, then try again."
            : humanizeError(err);
          toast.error(msg);
        },
      },
    );
  };
  return { connect: run, connectors, isPending: connect.isPending };
}

export function ConnectButton({ className, size = "default" }: { className?: string; size?: "default" | "sm" | "lg" }) {
  const mounted = useMounted();
  const { address, chainId, status } = useConnection();
  const { connect, connectors, isPending } = useConnectWallet();
  const { mutate: disconnect } = useDisconnect();
  const switchChain = useSwitchChain();

  if (!mounted || status === "reconnecting") {
    return (
      <Button size={size} variant="outline" className={className} disabled>
        <WalletIcon aria-hidden /> Connect wallet
      </Button>
    );
  }

  if (!address) {
    if (connectors.length <= 1) {
      return (
        <Button size={size} className={className} onClick={() => connect()} disabled={isPending}>
          <WalletIcon aria-hidden /> {isPending ? "Connecting…" : "Connect wallet"}
        </Button>
      );
    }
    return (
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button size={size} className={className} disabled={isPending} />}>
          <WalletIcon aria-hidden /> {isPending ? "Connecting…" : "Connect wallet"}
          <ChevronDownIcon className="opacity-70" aria-hidden />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuGroup>
            <DropdownMenuLabel>Choose a wallet</DropdownMenuLabel>
            {connectors.map((c) => (
              <DropdownMenuItem key={c.uid} onClick={() => connect(c)}>
                {c.icon ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={c.icon} alt="" className="size-4 rounded-sm" />
                ) : (
                  <WalletIcon aria-hidden />
                )}
                {c.name}
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  const wrongNetwork = chainId !== activeChain.id;
  if (wrongNetwork) {
    return (
      <Button
        size={size}
        variant="destructive"
        className={className}
        disabled={switchChain.isPending}
        onClick={() =>
          switchChain.mutate({ chainId: activeChain.id }, { onError: (e) => toast.error(humanizeError(e)) })
        }
      >
        <TriangleAlertIcon aria-hidden /> {switchChain.isPending ? "Switching…" : `Switch to ${activeChain.name}`}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button size={size} variant="outline" className={cn("font-mono", className)} />}>
        <span className="size-2 rounded-full bg-success" aria-hidden />
        {shortAddress(address)}
        <ChevronDownIcon className="opacity-70" aria-hidden />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-56">
        <DropdownMenuGroup>
          <DropdownMenuLabel className="font-normal">
            <span className="block text-xs text-muted-foreground">Connected to {activeChain.name}</span>
            <span className="block font-mono text-xs break-all text-foreground">{address}</span>
          </DropdownMenuLabel>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          onClick={() => navigator.clipboard.writeText(address).then(() => toast.success("Address copied"))}
        >
          <CopyIcon aria-hidden /> Copy address
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => window.open(explorerAddress(address), "_blank", "noopener,noreferrer")}>
          <ExternalLinkIcon aria-hidden /> View on explorer
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => disconnect()}>
          <LogOutIcon aria-hidden /> Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
