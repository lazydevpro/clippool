"use client";

import { Suspense } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { MenuIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Logo } from "@/components/common/logo";
import { ConnectButton } from "@/components/wallet/connect-button";
import { NetworkBanner } from "@/components/wallet/network-banner";
import { activeChain } from "@/lib/shared/chain";
import { IS_TESTNET, USE_MOCKS } from "@/lib/client/env";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

const NAV = [
  { href: "/#campaigns", label: "Campaigns", match: (p: string) => p.startsWith("/c/") },
  { href: "/campaigns/new", label: "Launch a campaign", match: (p: string) => p.startsWith("/campaigns/new") },
  { href: "/me", label: "Creator dashboard", match: (p: string) => p.startsWith("/me") },
];

// usePathname suspends on routes with unknown dynamic params (cacheComponents), so the active-state
// nav is isolated behind its own Suspense boundary and the rest of the header stays prerendered.
function ActiveMainNav() {
  return <MainNav pathname={usePathname() ?? "/"} />;
}

function MainNav({ pathname }: { pathname: string }) {
  return (
    <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
      {NAV.map((item) => {
        const active = pathname !== "" && item.match(pathname);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "rounded-md px-3 py-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
              active && "bg-muted text-foreground",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/80 backdrop-blur-md supports-backdrop-filter:bg-background/65">
      {USE_MOCKS && (
        <div className="bg-primary/15 text-center text-xs text-foreground/80">
          <p className="mx-auto max-w-6xl px-4 py-1">Demo mode: showing sample data. No transactions are sent.</p>
        </div>
      )}
      <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4 sm:px-6">
        <Link
          href="/"
          className="rounded-md focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
          aria-label="ClipPool home"
        >
          <Logo />
        </Link>
        <Suspense fallback={<MainNav pathname="" />}>
          <ActiveMainNav />
        </Suspense>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <span
            className="hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs text-muted-foreground lg:inline-flex"
            title={`Chain id ${activeChain.id}`}
          >
            <span className={cn("size-1.5 rounded-full", IS_TESTNET ? "bg-warning" : "bg-success")} aria-hidden />
            {activeChain.name}
          </span>
          <ThemeToggle />
          <ConnectButton className="hidden sm:inline-flex" />
          <Sheet>
            <SheetTrigger render={<Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu" />}>
              <MenuIcon aria-hidden />
            </SheetTrigger>
            <SheetContent side="right" className="w-72">
              <SheetHeader>
                <SheetTitle>
                  <Logo />
                </SheetTitle>
              </SheetHeader>
              <nav aria-label="Mobile" className="flex flex-col gap-1 px-4">
                {NAV.map((item) => (
                  <SheetClose
                    key={item.href}
                    nativeButton={false}
                    render={
                      <Link
                        href={item.href}
                        className="rounded-md px-3 py-2.5 text-sm hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                      />
                    }
                  >
                    {item.label}
                  </SheetClose>
                ))}
              </nav>
              <div className="px-4">
                <ConnectButton className="w-full" />
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
      <NetworkBanner />
    </header>
  );
}
