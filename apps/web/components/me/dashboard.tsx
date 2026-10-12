"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { ArrowRightIcon, LogOutIcon, SearchIcon, TrophyIcon, WalletIcon } from "lucide-react";
import { useQueries } from "@tanstack/react-query";
import type { Address } from "viem";
import type { CampaignSummary, LeaderboardEntry } from "@/lib/shared/api-types";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Address as AddressChip } from "@/components/common/address";
import { EmptyState, ErrorState } from "@/components/common/states";
import { campaignTitle } from "@/components/campaign/campaign-card";
import { StatusBadge, TokenIcon } from "@/components/campaign/status-badge";
import { CircleLoginButton } from "@/components/circle/circle-login-button";
import { ChannelAvatar, ConnectYouTubeButton, ScopeNote, YouTubeMark } from "@/components/youtube/connect-youtube";
import { useCampaigns, useCircleWallets } from "@/hooks/use-api";
import { useCircleSession } from "@/hooks/use-circle-session";
import { useMounted } from "@/hooks/use-mounted";
import { useYouTubeChannels } from "@/hooks/use-youtube";
import { api } from "@/lib/client/api";
import { logoutCircle, type CircleSession } from "@/lib/client/circle";
import { CIRCLE_LOGIN_ENABLED, YOUTUBE_CONNECT_ENABLED } from "@/lib/client/env";
import { formatInt, formatToken } from "@/lib/client/format";
import { HAS_RECEIPTS } from "@/lib/client/status";
import { validateWallet } from "@/lib/client/validation";

/**
 * Campaigns this wallet appears in. There is no per-wallet API yet, so this scans each campaign's
 * leaderboard client-side (fine for the handful of campaigns a pilot has).
 */
function useMyCampaigns(address: Address | undefined) {
  const list = useCampaigns();
  const campaigns = list.data?.campaigns ?? [];
  const boards = useQueries({
    queries: campaigns.map((c) => ({
      queryKey: ["leaderboard", c.id],
      queryFn: () => api.getLeaderboard(c.id),
      enabled: Boolean(address),
      staleTime: 30_000,
    })),
  });
  const pending = list.isPending || boards.some((b) => b.isPending);
  const error = list.error ?? boards.find((b) => b.error)?.error ?? null;
  const rows: { campaign: CampaignSummary; entry: LeaderboardEntry; rank: number }[] = [];
  if (address) {
    campaigns.forEach((c, i) => {
      const entries = boards[i]?.data?.entries ?? [];
      const idx = entries.findIndex((e) => e.wallet.toLowerCase() === address.toLowerCase());
      if (idx >= 0) rows.push({ campaign: c, entry: entries[idx], rank: idx + 1 });
    });
  }
  return { rows, pending: Boolean(address) && pending, error, refetch: () => list.refetch() };
}

function Balances({ session }: { session: CircleSession }) {
  const q = useCircleWallets(session.userToken);
  if (q.isPending) {
    return (
      <div className="grid grid-cols-2 gap-3" aria-busy="true">
        <Skeleton className="h-20 rounded-xl" />
        <Skeleton className="h-20 rounded-xl" />
      </div>
    );
  }
  if (q.isError) return <ErrorState title="Couldn't load balances" error={q.error} onRetry={() => q.refetch()} className="py-6" />;
  const key = Object.keys(q.data.balances).find((k) => k.toLowerCase() === session.address.toLowerCase());
  const bal = key ? q.data.balances[key] : undefined;
  return (
    <dl className="grid grid-cols-2 gap-3">
      {(["USDC", "EURC"] as const).map((t) => (
        <div key={t} className="rounded-xl border bg-background/50 p-4">
          <dt className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <TokenIcon symbol={t} /> {t}
          </dt>
          <dd className="mt-1.5 text-xl font-semibold tracking-tight num">{formatToken(normalizeBalance(bal?.[t]))}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Balances are base-unit strings per the API contract; tolerate human decimals ("12.5") too. */
function normalizeBalance(v: string | undefined): string {
  if (!v) return "0";
  if (!v.includes(".")) return v;
  const [i, f = ""] = v.split(".");
  return (BigInt(i || "0") * 1_000_000n + BigInt((f + "000000").slice(0, 6))).toString();
}

/** Channels linked to this wallet via Connect YouTube (main submission path). */
function YouTubeChannelsCard({ address }: { address: Address }) {
  const q = useYouTubeChannels(address);
  const channels = q.data?.channels ?? [];
  return (
    <section aria-labelledby="yt-channels" className="space-y-3 border-t pt-4">
      <h2 id="yt-channels" className="flex items-center gap-2 text-sm font-semibold">
        <YouTubeMark className="h-3.5" /> YouTube channels
      </h2>
      {q.isPending ? (
        <Skeleton className="h-10 rounded-lg" />
      ) : q.isError ? (
        <ErrorState title="Couldn't load channels" error={q.error} onRetry={() => q.refetch()} className="py-4" />
      ) : channels.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Connect your channel once and your eligible Shorts show up in every campaign. No binding codes needed.
        </p>
      ) : (
        <ul className="space-y-2">
          {channels.map((c) => (
            <li key={c.channelId} className="flex min-w-0 items-center gap-2.5 text-sm">
              <ChannelAvatar channel={c} className="size-7" />
              <a
                href={`https://www.youtube.com/channel/${c.channelId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="truncate hover:underline"
              >
                {c.title || c.channelId}
              </a>
            </li>
          ))}
        </ul>
      )}
      {!q.isPending && !q.isError && (
        <ConnectYouTubeButton wallet={address} variant={channels.length ? "another" : "primary"} className="[&_button]:w-full" />
      )}
      <ScopeNote />
    </section>
  );
}

function MyCampaigns({ address }: { address: Address }) {
  const { rows, pending, error, refetch } = useMyCampaigns(address);
  return (
    <section aria-labelledby="my-campaigns" className="rounded-2xl border bg-card">
      <div className="border-b px-5 py-4">
        <h2 id="my-campaigns" className="font-semibold">
          Your campaigns
        </h2>
        <p className="mt-0.5 text-xs text-muted-foreground">Campaigns where this wallet has an accepted Short.</p>
      </div>
      <div className="p-5">
        {pending ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
        ) : error ? (
          <ErrorState title="Couldn't load your campaigns" error={error} onRetry={refetch} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<TrophyIcon className="size-5" aria-hidden />}
            title="No submissions yet"
            description="Pick a live campaign, connect YouTube, and submit your Shorts."
            action={
              <Link href="/#campaigns" className={buttonVariants({ size: "sm" })}>
                Find a campaign
              </Link>
            }
          />
        ) : (
          <ul className="space-y-3">
            {rows.map(({ campaign: c, entry, rank }) => (
              <li key={c.id}>
                <Link
                  href={HAS_RECEIPTS.includes(c.status) ? `/c/${c.id}/receipts` : `/c/${c.id}`}
                  className="flex flex-col gap-3 rounded-xl border p-4 transition-colors hover:border-primary/40 hover:bg-muted/30 sm:flex-row sm:items-center"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <StatusBadge status={c.status} />
                      <span className="text-xs text-muted-foreground num">Rank #{rank}</span>
                    </div>
                    <p className="mt-1.5 truncate font-medium">{campaignTitle(c)}</p>
                    <p className="text-xs text-muted-foreground num">
                      {formatInt(entry.videos.length)} {entry.videos.length === 1 ? "Short" : "Shorts"} · {formatInt(entry.views)} views
                    </p>
                  </div>
                  <div className="flex items-center gap-3 sm:text-right">
                    <div>
                      <p className="text-xs text-muted-foreground">{HAS_RECEIPTS.includes(c.status) ? "Payout" : "Est. payout"}</p>
                      <p className="font-semibold num">{formatToken(entry.estimatedAmount, c.tokenSymbol)}</p>
                    </div>
                    <ArrowRightIcon className="size-4 text-muted-foreground" aria-hidden />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function LookupForm({ onAddress }: { onAddress: (a: Address) => void }) {
  const [value, setValue] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const id = useId();
  return (
    <form
      noValidate
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        const r = validateWallet(value);
        setErr(r.error ?? null);
        if (r.address) onAddress(r.address);
      }}
    >
      <Label htmlFor={id}>Track a payout wallet</Label>
      <div className="flex gap-2">
        <Input
          id={id}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0x…"
          className="h-10 font-mono text-sm"
          spellCheck={false}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
        />
        <Button type="submit" variant="outline" className="h-10" aria-label="Look up wallet">
          <SearchIcon aria-hidden />
        </Button>
      </div>
      {err && (
        <p id={`${id}-err`} role="alert" className="text-xs text-destructive">
          {err}
        </p>
      )}
    </form>
  );
}

export function CreatorDashboard() {
  const mounted = useMounted();
  const session = useCircleSession();
  const [lookup, setLookup] = useState<Address | null>(null);
  const address = (session?.address ?? lookup ?? undefined) as Address | undefined;

  if (!mounted) {
    return (
      <div className="grid gap-6 lg:grid-cols-[22rem_1fr]" aria-busy="true">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    );
  }

  if (!address) {
    return (
      <div className="mx-auto grid max-w-3xl gap-6 rounded-3xl border bg-card p-6 sm:p-10 md:grid-cols-2">
        <div className="space-y-3">
          <span className="flex size-11 items-center justify-center rounded-xl bg-primary/15">
            <WalletIcon className="size-5 text-primary dark:text-brand-soft" aria-hidden />
          </span>
          <h2 className="text-xl font-semibold">Sign in to see your earnings</h2>
          <p className="text-sm text-muted-foreground">
            Your Google account gets a USDC wallet on Arc. Payouts from every campaign land there automatically.
          </p>
        </div>
        <div className="flex flex-col justify-center gap-6">
          {CIRCLE_LOGIN_ENABLED ? (
            <CircleLoginButton />
          ) : (
            <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
              Google sign-in isn&apos;t configured on this deployment. You can still track any payout wallet below.
            </p>
          )}
          <LookupForm onAddress={setLookup} />
        </div>
      </div>
    );
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[22rem_minmax(0,1fr)]">
      <aside className="space-y-4 rounded-2xl border bg-card p-5 lg:self-start">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">
              {session ? `Circle wallet${session.email ? ` · ${session.email}` : ""}` : "Tracking wallet"}
            </p>
            <AddressChip address={address} className="mt-1 text-sm" />
          </div>
          {session ? (
            <Button size="icon-sm" variant="ghost" onClick={logoutCircle} aria-label="Sign out">
              <LogOutIcon aria-hidden />
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setLookup(null)}>
              Change
            </Button>
          )}
        </div>
        {session ? (
          <Balances session={session} />
        ) : (
          <p className="text-xs text-muted-foreground">Balances are shown for Google (Circle) wallets.</p>
        )}
        <Link href="/#campaigns" className={buttonVariants({ variant: "outline", className: "w-full" })}>
          Find campaigns to join
        </Link>
        {YOUTUBE_CONNECT_ENABLED && <YouTubeChannelsCard address={address} />}
      </aside>
      <MyCampaigns address={address} />
    </div>
  );
}
