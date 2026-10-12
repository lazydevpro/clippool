"use client";

import { LoaderCircleIcon, PlusIcon, ShieldCheckIcon, TriangleAlertIcon } from "lucide-react";
import type { YouTubeChannel } from "@/lib/shared/api-types";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { useConnectYouTube } from "@/hooks/use-youtube";
import { cn } from "@/lib/utils";

/** YouTube's play-button mark (inline; lucide no longer ships brand icons). */
export function YouTubeMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 28 20" className={cn("h-[1em] w-auto", className)} aria-hidden focusable="false">
      <path
        fill="#FF0033"
        d="M27.4 3.1A3.5 3.5 0 0 0 24.9.6C22.8 0 14 0 14 0S5.2 0 3.1.6A3.5 3.5 0 0 0 .6 3.1C0 5.3 0 10 0 10s0 4.7.6 6.9a3.5 3.5 0 0 0 2.5 2.5C5.2 20 14 20 14 20s8.8 0 10.9-.6a3.5 3.5 0 0 0 2.5-2.5c.6-2.2.6-6.9.6-6.9s0-4.7-.6-6.9Z"
      />
      <path fill="#fff" d="m11.2 14.3 7.3-4.3-7.3-4.3v8.6Z" />
    </svg>
  );
}

/** What we ask Google for, in one line. */
export function ScopeNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex items-start gap-2 text-xs text-muted-foreground", className)}>
      <ShieldCheckIcon className="mt-px size-4 shrink-0 text-success" aria-hidden />
      <span>
        Read-only — we only read which channels you own. We never post, and we never store your Google login.
      </span>
    </p>
  );
}

export function ChannelAvatar({ channel, className }: { channel: YouTubeChannel; className?: string }) {
  if (channel.thumbnailUrl) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={channel.thumbnailUrl} alt="" className={cn("size-6 shrink-0 rounded-full object-cover", className)} loading="lazy" />;
  }
  return (
    <span
      className={cn(
        "flex size-6 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-primary/60 to-brand-soft/30 text-[10px] font-semibold text-white",
        className,
      )}
      aria-hidden
    >
      {channel.title.trim().charAt(0).toUpperCase() || "Y"}
    </span>
  );
}

export function ChannelChips({ channels, className }: { channels: YouTubeChannel[]; className?: string }) {
  return (
    <ul className={cn("flex flex-wrap gap-2", className)} aria-label="Connected channels">
      {channels.map((c) => (
        <li key={c.channelId} className="flex min-w-0 items-center gap-2 rounded-full border bg-muted/40 py-1 pr-3 pl-1 text-sm">
          <ChannelAvatar channel={c} />
          <span className="truncate">{c.title || c.channelId}</span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Opens the Google popup (youtube.readonly) and links the channel(s) to `wallet`.
 * `variant="primary"` is the big main-path button; `"another"` is the small "Connect another channel".
 */
export function ConnectYouTubeButton({
  wallet,
  variant = "primary",
  onConnected,
  className,
}: {
  wallet: string;
  variant?: "primary" | "another";
  onConnected?: (channels: YouTubeChannel[]) => void;
  className?: string;
}) {
  const { connect, pending, error } = useConnectYouTube(wallet);
  const primary = variant === "primary";
  return (
    <div className={cn("space-y-3", className)}>
      <Button
        type="button"
        size={primary ? "lg" : "sm"}
        variant={primary ? "default" : "outline"}
        className={cn(primary && "h-12 w-full text-base sm:w-auto sm:px-6")}
        disabled={pending}
        onClick={async () => {
          const res = await connect({ selectAccount: !primary });
          if (res) onConnected?.(res.channels);
        }}
      >
        {pending ? (
          <LoaderCircleIcon className="animate-spin" aria-hidden />
        ) : primary ? (
          <span className="flex items-center rounded-sm bg-white px-1 py-0.5">
            <YouTubeMark className="h-3.5" />
          </span>
        ) : (
          <PlusIcon aria-hidden />
        )}
        {pending ? "Waiting for Google…" : primary ? "Connect YouTube" : "Connect another channel"}
      </Button>
      {error && (
        <Alert variant="destructive" aria-live="polite">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
    </div>
  );
}
