"use client";

import { useEffect, useState } from "react";
import { LoaderCircleIcon, LogOutIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Address } from "@/components/common/address";
import { useCircleSession } from "@/hooks/use-circle-session";
import {
  hasPendingCircleLogin,
  logoutCircle,
  resumeGoogleLogin,
  startGoogleLogin,
  type CirclePhase,
  type CircleSession,
} from "@/lib/client/circle";
import { CIRCLE_LOGIN_ENABLED } from "@/lib/client/env";
import { humanizeError } from "@/lib/client/errors";
import { cn } from "@/lib/utils";

const PHASE_LABEL: Record<CirclePhase, string> = {
  device: "Preparing secure sign-in…",
  redirecting: "Redirecting to Google…",
  verifying: "Verifying your Google account…",
  initializing: "Setting up your wallet…",
  pin: "Finish setup in the Circle window…",
  wallet: "Fetching your Arc wallet…",
};

/**
 * "Continue with Google" via Circle user-controlled wallets. Creates (or unlocks) an Arc wallet for the
 * creator; no seed phrase. Renders nothing when Circle isn't configured (and mocks are off).
 */
export function CircleLoginButton({
  onSession,
  className,
  label = "Continue with Google",
}: {
  onSession?: (s: CircleSession) => void;
  className?: string;
  label?: string;
}) {
  const session = useCircleSession();
  const [phase, setPhase] = useState<CirclePhase | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Returning from the Google redirect: finish the login automatically.
  useEffect(() => {
    if (!CIRCLE_LOGIN_ENABLED) return;
    let cancelled = false;
    void Promise.resolve().then(async () => {
      if (cancelled || !hasPendingCircleLogin()) return;
      setError(null);
      try {
        const s = await resumeGoogleLogin((p) => !cancelled && setPhase(p));
        if (!cancelled) onSession?.(s);
      } catch (err) {
        if (!cancelled) setError(humanizeError(err));
      } finally {
        if (!cancelled) setPhase(null);
      }
    });
    return () => {
      cancelled = true;
    };
    // onSession is intentionally not a dependency: this runs once per page load.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (!CIRCLE_LOGIN_ENABLED) return null;

  if (session && !phase) {
    return (
      <div className={cn("flex flex-wrap items-center justify-between gap-2 rounded-xl border bg-muted/40 p-3", className)}>
        <div className="min-w-0 text-sm">
          <p className="text-xs text-muted-foreground">Signed in with Google{session.email ? ` · ${session.email}` : ""}</p>
          <Address address={session.address} />
        </div>
        <div className="flex items-center gap-1">
          {onSession && (
            <Button size="sm" onClick={() => onSession(session)}>
              Use this wallet
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" onClick={logoutCircle} aria-label="Sign out of Google wallet">
            <LogOutIcon aria-hidden />
          </Button>
        </div>
      </div>
    );
  }

  const start = async () => {
    setError(null);
    try {
      const s = await startGoogleLogin(setPhase);
      if (s) {
        setPhase(null);
        onSession?.(s);
      }
      // Real mode: the page navigates to Google; nothing else to do here.
    } catch (err) {
      setPhase(null);
      setError(humanizeError(err));
    }
  };

  return (
    <div className={cn("space-y-2", className)}>
      <Button
        type="button"
        variant="outline"
        size="lg"
        className="h-11 w-full bg-background"
        onClick={start}
        disabled={phase !== null}
        aria-describedby="circle-login-help"
      >
        {phase ? <LoaderCircleIcon className="animate-spin" aria-hidden /> : <GoogleGlyph />}
        {phase ? PHASE_LABEL[phase] : label}
      </Button>
      <p id="circle-login-help" className="text-xs text-muted-foreground">
        Creates a USDC wallet on Arc for your Google account, secured by Circle. No seed phrase.
      </p>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function GoogleGlyph() {
  return (
    <svg viewBox="0 0 48 48" className="size-4" aria-hidden>
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

