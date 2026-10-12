"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CircleCheckIcon,
  ExternalLinkIcon,
  EyeIcon,
  LoaderCircleIcon,
  TriangleAlertIcon,
  WalletIcon,
  XCircleIcon,
} from "lucide-react";
import type { Address } from "viem";
import { useConnection } from "wagmi";
import type { CampaignDetail, SubmissionResponse } from "@/lib/shared/api-types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Address as AddressChip } from "@/components/common/address";
import { CopyButton } from "@/components/common/copy-button";
import { Stepper } from "@/components/common/stepper";
import { CampaignBreadcrumb } from "@/components/campaign/campaign-view";
import { campaignTitle } from "@/components/campaign/campaign-card";
import { CampaignLoader, PageContainer } from "@/components/campaign/campaign-loader";
import { StatusBadge } from "@/components/campaign/status-badge";
import { CircleLoginButton } from "@/components/circle/circle-login-button";
import { ConnectStep, NotLiveAlert, ShortsStep } from "@/components/submit/youtube-steps";
import { ErrorState } from "@/components/common/states";
import { Skeleton } from "@/components/ui/skeleton";
import { useMounted } from "@/hooks/use-mounted";
import { useYouTubeChannels } from "@/hooks/use-youtube";
import { api } from "@/lib/client/api";
import { bindingCode } from "@/lib/client/binding";
import { CIRCLE_LOGIN_ENABLED, YOUTUBE_CONNECT_ENABLED } from "@/lib/client/env";
import { REJECT_MESSAGES, humanizeError } from "@/lib/client/errors";
import { formatDateTime, formatInt, formatToken } from "@/lib/client/format";
import { looksLikeShortsUrl, validateWallet } from "@/lib/client/validation";
import { cn } from "@/lib/utils";

type Mode = "youtube" | "code";
const STEPS: Record<Mode, string[]> = {
  youtube: ["Payout wallet", "Connect YouTube", "Pick your Shorts"],
  code: ["Payout wallet", "Binding code", "Submit Short"],
};
const WALLET_KEY = "clippool.payoutWallet";

// ── Step 1 ──
function WalletStep({ initial, onDone }: { initial: string; onDone: (a: Address) => void }) {
  const mounted = useMounted();
  const { address: connected } = useConnection();
  const [value, setValue] = useState(initial);
  const [touched, setTouched] = useState(false);
  const inputId = useId();
  const check = validateWallet(value);
  const showError = touched && check.error;

  const choose = (a: Address) => {
    try {
      window.localStorage.setItem(WALLET_KEY, a);
    } catch {}
    onDone(a);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Where should we send your payout?</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Payouts are pushed to this address automatically on Arc. Use a wallet you control: your channel stays linked to it
          for this campaign.
        </p>
      </div>

      <form
        className="space-y-3"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (check.address) choose(check.address);
        }}
      >
        <Label htmlFor={inputId}>Paste a wallet address</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={inputId}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="0x…"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            className="h-11 font-mono text-sm"
            aria-invalid={showError ? true : undefined}
            aria-describedby={showError ? `${inputId}-err` : undefined}
          />
          <Button type="submit" size="lg" className="h-11 sm:w-36">
            Continue <ArrowRightIcon aria-hidden />
          </Button>
        </div>
        {showError && (
          <p id={`${inputId}-err`} role="alert" className="text-xs text-destructive">
            {check.error}
          </p>
        )}
        {mounted && connected && connected.toLowerCase() !== value.trim().toLowerCase() && (
          <button
            type="button"
            className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline dark:text-brand-soft"
            onClick={() => {
              setValue(connected);
              setTouched(true);
            }}
          >
            <WalletIcon className="size-3.5" aria-hidden /> Use connected wallet {connected.slice(0, 6)}…{connected.slice(-4)}
          </button>
        )}
      </form>

      {CIRCLE_LOGIN_ENABLED && (
        <>
          <div className="flex items-center gap-3 text-xs text-muted-foreground" aria-hidden>
            <span className="h-px flex-1 bg-border" /> or, no wallet yet? <span className="h-px flex-1 bg-border" />
          </div>
          <CircleLoginButton onSession={(s) => choose(s.address)} />
        </>
      )}
    </div>
  );
}

// ── Step 2 ──
function CodeStep({
  campaign,
  wallet,
  onBack,
  onNext,
  onUseYouTube,
}: {
  campaign: CampaignDetail;
  wallet: Address;
  onBack: () => void;
  onNext: () => void;
  onUseYouTube?: () => void;
}) {
  const code = bindingCode(campaign.id, wallet);
  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Add this code to your Short&apos;s description</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          It proves the video is yours and links it to your payout wallet. It&apos;s unique to this campaign and wallet.
        </p>
      </div>

      <div className="relative overflow-hidden rounded-2xl border border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-6 text-center">
        <p className="text-xs tracking-widest text-muted-foreground uppercase">Your binding code</p>
        <p className="mt-3 font-mono text-4xl font-semibold tracking-wider select-all sm:text-5xl" aria-live="polite">
          {code}
        </p>
        <div className="mt-5 flex justify-center">
          <CopyButton value={code} label="Copy code" toastLabel="Binding code copied" showLabel size="lg" />
        </div>
        <p className="mt-4 flex flex-wrap items-center justify-center gap-1 text-xs text-muted-foreground">
          Pays out to <AddressChip address={wallet} className="text-foreground" />
        </p>
      </div>

      <ol className="space-y-3 text-sm">
        {[
          <>Open YouTube Studio → your Short → <strong>Details</strong>.</>,
          <>
            Paste <code className="rounded bg-muted px-1.5 py-0.5 font-mono">{code}</code> anywhere in the description and
            save.
          </>,
          <>
            Make sure it&apos;s <strong>public</strong> and published between{" "}
            <span className="num">{formatDateTime(campaign.startTime)}</span> and{" "}
            <span className="num">{formatDateTime(campaign.endTime)}</span>.
          </>,
        ].map((t, i) => (
          <li key={i} className="flex gap-3">
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold num">
              {i + 1}
            </span>
            <span className="pt-0.5 text-muted-foreground [&_strong]:text-foreground">{t}</span>
          </li>
        ))}
      </ol>

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-between">
        <Button variant="ghost" size="lg" className="h-11" onClick={onBack}>
          <ArrowLeftIcon aria-hidden /> Change wallet
        </Button>
        <Button size="lg" className="h-11" onClick={onNext}>
          I&apos;ve added it <ArrowRightIcon aria-hidden />
        </Button>
      </div>
      {onUseYouTube && (
        <p className="text-center text-sm">
          <button type="button" className="text-primary hover:underline dark:text-brand-soft" onClick={onUseYouTube}>
            Skip the code: connect YouTube instead
          </button>
        </p>
      )}
    </div>
  );
}

// ── Step 3 ──
function SubmitStep({
  campaign,
  wallet,
  proof,
  backLabel,
  onBack,
  onAccepted,
}: {
  campaign: CampaignDetail;
  wallet: Address;
  /** "youtube": ownership comes from the connected channel; "code": from the binding code. */
  proof: Mode;
  backLabel: string;
  onBack: () => void;
  onAccepted: (accepted: boolean) => void;
}) {
  const [url, setUrl] = useState("");
  const [touched, setTouched] = useState(false);
  const [pending, setPending] = useState(false);
  const [result, setResult] = useState<SubmissionResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputId = useId();
  const live = campaign.status === "live";
  const urlOk = looksLikeShortsUrl(url);
  const showUrlError = touched && url.trim() !== "" && !urlOk;

  const submit = async () => {
    setTouched(true);
    if (!urlOk || !live) return;
    setPending(true);
    setError(null);
    setResult(null);
    try {
      const res = await api.submit({ campaignId: campaign.id, videoUrl: url.trim(), wallet });
      setResult(res);
      onAccepted(res.status === "accepted");
    } catch (err) {
      setError(humanizeError(err));
    } finally {
      setPending(false);
    }
  };

  if (result?.status === "accepted") {
    const s = result.submission;
    return (
      <div className="space-y-6" aria-live="polite">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-full bg-success/15">
            <CircleCheckIcon className="size-6 text-success" aria-hidden />
          </span>
          <h2 className="text-xl font-semibold">You&apos;re in!</h2>
          <p className="max-w-md text-sm text-muted-foreground">
            Your Short is part of the pool. Views keep counting until the snapshot; your payout is sent automatically.
          </p>
        </div>
        {s && (
          <a
            href={`https://www.youtube.com/shorts/${s.videoId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-4 rounded-2xl border bg-muted/30 p-4 transition-colors hover:border-primary/40"
          >
            <span className="flex aspect-[9/16] w-14 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/50 to-brand-soft/20">
              <EyeIcon className="size-5 text-white/80" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="line-clamp-2 font-medium">{s.title}</span>
              <span className="mt-1 block text-sm text-muted-foreground">{s.channelTitle}</span>
              <span className="mt-1 block text-xs text-muted-foreground num">{formatInt(s.views)} views so far</span>
            </span>
            <ExternalLinkIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </a>
        )}
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-between">
          <Button
            variant="outline"
            size="lg"
            className="h-11"
            onClick={() => {
              setResult(null);
              setUrl("");
              setTouched(false);
              onAccepted(false);
            }}
          >
            Submit another Short
          </Button>
          <Link href={`/c/${campaign.id}`} className={buttonVariants({ size: "lg", className: "h-11" })}>
            See the leaderboard <ArrowRightIcon aria-hidden />
          </Link>
        </div>
      </div>
    );
  }

  const reject = result?.status === "rejected" ? (result.reason ? REJECT_MESSAGES[result.reason] : null) : null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold">Paste your Short&apos;s link</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {proof === "youtube"
            ? "It must come from a channel you connected. We check the publish date and that it's a public Short. Takes a few seconds."
            : "We check the description for your code, the publish date, and that it's a public Short. Takes a few seconds."}
        </p>
      </div>

      <NotLiveAlert campaign={campaign} codeHint={proof === "code"} />

      <form
        noValidate
        className="space-y-2"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <Label htmlFor={inputId}>YouTube Shorts URL</Label>
        <div className="flex flex-col gap-2 sm:flex-row">
          <Input
            id={inputId}
            type="url"
            inputMode="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={() => setTouched(true)}
            placeholder="https://youtube.com/shorts/…"
            className="h-11"
            aria-invalid={showUrlError ? true : undefined}
            aria-describedby={showUrlError ? `${inputId}-err` : undefined}
            disabled={pending}
          />
          <Button type="submit" size="lg" className="h-11 sm:w-36" disabled={pending || !live}>
            {pending ? (
              <>
                <LoaderCircleIcon className="animate-spin" aria-hidden /> Checking…
              </>
            ) : (
              "Submit"
            )}
          </Button>
        </div>
        {showUrlError && (
          <p id={`${inputId}-err`} role="alert" className="text-xs text-destructive">
            Paste a link like https://youtube.com/shorts/abc123XYZ09
          </p>
        )}
      </form>

      {result?.status === "rejected" && (
        <Alert variant="destructive" aria-live="polite">
          <XCircleIcon aria-hidden />
          <AlertTitle>{reject?.title ?? "Submission rejected"}</AlertTitle>
          <AlertDescription>
            {reject?.hint ?? result.message ?? "This video doesn't meet the campaign rules."}
            {result.reason === "missing_binding_code" && proof === "code" && (
              <span className="mt-1 block">
                Your code: <code className="font-mono font-semibold">{bindingCode(campaign.id, wallet)}</code>
              </span>
            )}
          </AlertDescription>
        </Alert>
      )}
      {error && (
        <Alert variant="destructive">
          <TriangleAlertIcon aria-hidden />
          <AlertTitle>Couldn&apos;t submit</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <Button variant="ghost" size="lg" className="h-11" onClick={onBack}>
        <ArrowLeftIcon aria-hidden /> {backLabel}
      </Button>
    </div>
  );
}

function readSavedWallet(): string {
  try {
    return window.localStorage.getItem(WALLET_KEY) ?? "";
  } catch {
    return "";
  }
}

function StepLoading() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Checking connected channels">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-full" />
      <Skeleton className="h-32 rounded-2xl" />
    </div>
  );
}

function SubmitBody({ campaign }: { campaign: CampaignDetail }) {
  const [mode, setMode] = useState<Mode>(YOUTUBE_CONNECT_ENABLED ? "youtube" : "code");
  const [step, setStep] = useState(0);
  const [wallet, setWallet] = useState<Address | null>(null);
  const [pasteLink, setPasteLink] = useState(false);
  const [done, setDone] = useState(false);
  // Rendered only after the campaign loaded on the client, so localStorage is available here.
  const [saved] = useState(readSavedWallet);
  const channels = useYouTubeChannels(wallet ?? undefined, mode === "youtube" && step > 0);
  const linked = (channels.data?.channels.length ?? 0) > 0;

  const useCode = () => {
    setMode("code");
    setPasteLink(false);
    setDone(false);
    setStep(wallet ? 1 : 0);
  };
  const useYouTube = () => {
    setMode("youtube");
    setDone(false);
    setStep(wallet ? 1 : 0);
  };
  const changeWallet = () => {
    setStep(0);
    setPasteLink(false);
    setDone(false);
  };

  // Displayed stepper position. YouTube mode skips "Connect" when the wallet already has channels.
  const current =
    step === 0 ? 0 : mode === "code" ? step : done ? 3 : channels.isPending ? 1 : linked ? 2 : 1;

  let body: ReactNode;
  if (step === 0) {
    body = (
      <WalletStep
        initial={wallet ?? saved}
        onDone={(a) => {
          setWallet(a);
          setDone(false);
          setStep(1);
        }}
      />
    );
  } else if (!wallet) {
    body = null;
  } else if (mode === "code") {
    body =
      step === 1 ? (
        <CodeStep
          campaign={campaign}
          wallet={wallet}
          onBack={changeWallet}
          onNext={() => setStep(2)}
          onUseYouTube={YOUTUBE_CONNECT_ENABLED ? useYouTube : undefined}
        />
      ) : (
        <SubmitStep
          campaign={campaign}
          wallet={wallet}
          proof="code"
          backLabel="Back to code"
          onBack={() => setStep(1)}
          onAccepted={(ok) => setStep(ok ? 3 : 2)}
        />
      );
  } else if (channels.isPending) {
    body = <StepLoading />;
  } else if (channels.isError) {
    body = (
      <div className="space-y-4">
        <ErrorState title="Couldn't check your connected channels" error={channels.error} onRetry={() => channels.refetch()} />
        <p className="text-center text-sm">
          <button type="button" className="text-muted-foreground hover:text-foreground hover:underline" onClick={useCode}>
            Use a binding code instead
          </button>
        </p>
      </div>
    );
  } else if (!linked) {
    body = <ConnectStep wallet={wallet} onBack={changeWallet} onUseCode={useCode} />;
  } else if (pasteLink) {
    body = (
      <SubmitStep
        campaign={campaign}
        wallet={wallet}
        proof="youtube"
        backLabel="Back to your Shorts"
        onBack={() => setPasteLink(false)}
        onAccepted={(ok) => ok && setDone(true)}
      />
    );
  } else {
    body = (
      <ShortsStep
        campaign={campaign}
        wallet={wallet}
        onBack={changeWallet}
        onUseCode={useCode}
        onPaste={() => setPasteLink(true)}
        onAccepted={() => setDone(true)}
      />
    );
  }

  return (
    <PageContainer className="max-w-3xl space-y-8">
      <CampaignBreadcrumb campaign={campaign} page="Submit" />
      <header className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={campaign.status} />
          <span className="text-sm text-muted-foreground num">
            Pool {formatToken(campaign.pool, campaign.tokenSymbol)}
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Submit to <span className="text-gradient">{campaignTitle(campaign)}</span>
        </h1>
      </header>

      <Stepper steps={STEPS[mode]} current={current} />

      <div className={cn("rounded-2xl border bg-card p-5 sm:p-8")}>{body}</div>

      <p className="text-center text-xs text-muted-foreground">
        Submitting is free. ClipPool never asks for your seed phrase or a signature to submit.
      </p>
    </PageContainer>
  );
}

export function SubmitFlow({ id }: { id: string }) {
  return <CampaignLoader id={id}>{(c) => <SubmitBody campaign={c} />}</CampaignLoader>;
}
