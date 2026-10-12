"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Loader2, ShieldCheck, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { hasPendingCircleLogin, pendingReturnTo, resumeGoogleLogin, type CirclePhase } from "@/lib/client/circle";

const PHASE_LABEL: Record<CirclePhase, string> = {
  device: "Preparing sign-in…",
  redirecting: "Redirecting to Google…",
  verifying: "Verifying your Google account…",
  initializing: "Setting up your Arc wallet…",
  pin: "Finish wallet setup in the Circle window…",
  wallet: "Loading your wallet…",
};

/** Fixed Google OAuth redirect target for Circle user-controlled wallets. Finishes the login,
 *  then returns the user to the page where they clicked "Continue with Google". */
export default function CircleAuthCallbackPage() {
  const router = useRouter();
  const [phase, setPhase] = useState<CirclePhase>("verifying");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!hasPendingCircleLogin()) {
      void Promise.resolve().then(() => !cancelled && setError("This sign-in link has expired or was already used."));
      return () => {
        cancelled = true;
      };
    }
    const returnTo = pendingReturnTo();
    resumeGoogleLogin((p) => !cancelled && setPhase(p))
      .then(() => !cancelled && router.replace(returnTo))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "Google sign-in failed."));
    return () => {
      cancelled = true;
    };
  }, [router]);

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md items-center px-4 py-16">
      <Card className="w-full">
        <CardContent className="flex flex-col items-center gap-4 py-10 text-center">
          {error ? (
            <>
              <TriangleAlert className="size-8 text-destructive" aria-hidden />
              <p className="font-medium">Sign-in didn’t complete</p>
              <p className="text-sm text-muted-foreground">{error}</p>
              <Button nativeButton={false} render={<Link href="/me" />}>Back to ClipPool</Button>
            </>
          ) : (
            <>
              <Loader2 className="size-8 animate-spin text-primary" aria-hidden />
              <p className="font-medium" role="status" aria-live="polite">
                {PHASE_LABEL[phase]}
              </p>
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <ShieldCheck className="size-3.5" aria-hidden /> Wallet keys stay with you, secured by Circle.
              </p>
            </>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
