"use client";

import { useId, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  CheckIcon,
  CircleAlertIcon,
  InfoIcon,
  LoaderCircleIcon,
  LockIcon,
  RotateCwIcon,
  SettingsIcon,
  WalletIcon,
} from "lucide-react";
import { toast } from "sonner";
import { formatUnits, parseUnits, type Address, type Hash } from "viem";
import { useConnection, useReadContract, useSwitchChain } from "wagmi";
import { erc20PermitAbi } from "@/lib/shared/abi";
import { activeChain, chainKey, TOKENS, TOKEN_DECIMALS, type TokenSymbol } from "@/lib/shared/chain";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { TxLink } from "@/components/common/explorer-link";
import { TokenIcon } from "@/components/campaign/status-badge";
import { ConnectButton } from "@/components/wallet/connect-button";
import { useContractWindows } from "@/hooks/use-contract-windows";
import { useMounted } from "@/hooks/use-mounted";
import { api } from "@/lib/client/api";
import { createCampaignOnchain, InsufficientBalanceError, rulesHashOf, type CreateStep } from "@/lib/client/create-campaign";
import { CLIPPOOL, IS_TESTNET, USE_MOCKS } from "@/lib/client/env";
import { humanizeError, isUserRejection } from "@/lib/client/errors";
import { delayPresets } from "@/lib/client/validation";
import { formatDateTime, formatDelay, formatInt, formatToken, shortHash } from "@/lib/client/format";
import { cn } from "@/lib/utils";

// ── schema ──
const safePool = (v: string) => {
  try {
    return /^\d+(\.\d{1,6})?$/.test(v.trim()) ? parseUnits(v.trim(), TOKEN_DECIMALS) : 0n;
  } catch {
    return 0n;
  }
};

/** The contract only needs start < end; testnet allows short campaigns for quick end-to-end runs. */
const MIN_CAMPAIGN_MS = IS_TESTNET ? 5 * 60_000 : 60 * 60_000;

const schema = z
  .object({
    title: z.string().trim().min(4, "Use at least 4 characters.").max(80, "Keep it under 80 characters."),
    rules: z
      .string()
      .trim()
      .min(20, "Describe what qualifies (at least 20 characters).")
      .max(5000, "Keep the rules under 5,000 characters."),
    token: z.enum(["USDC", "EURC"]),
    pool: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,6})?$/, "Enter an amount like 1000 or 250.50 (up to 6 decimals).")
      .refine((v) => safePool(v) >= 10n ** BigInt(TOKEN_DECIMALS), "The minimum pool is 1."),
    start: z.string().min(1, "Pick a start time."),
    end: z.string().min(1, "Pick an end time."),
    delay: z.string().regex(/^\d+$/), // seconds; checked against MIN_MEASUREMENT_DELAY() on submit
    capPct: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, "Enter a percentage, e.g. 20.")
      .refine((v) => Number(v) >= 1 && Number(v) <= 100, "Between 1% and 100%."),
    minViews: z
      .string()
      .trim()
      .regex(/^\d+$/, "Enter a whole number.")
      .refine((v) => Number(v) <= 4_294_967_295, "That's too large."),
  })
  .superRefine((v, ctx) => {
    const s = new Date(v.start).getTime();
    const e = new Date(v.end).getTime();
    if (Number.isNaN(s)) ctx.addIssue({ code: "custom", path: ["start"], message: "Invalid date." });
    if (Number.isNaN(e)) ctx.addIssue({ code: "custom", path: ["end"], message: "Invalid date." });
    if (Number.isNaN(s) || Number.isNaN(e)) return;
    if (s < nowMs() - 5 * 60_000) ctx.addIssue({ code: "custom", path: ["start"], message: "Start can't be in the past." });
    if (e < s + MIN_CAMPAIGN_MS) {
      const min = formatDelay(MIN_CAMPAIGN_MS / 1000);
      ctx.addIssue({ code: "custom", path: ["end"], message: `End at least ${min} after the start.` });
    }
  });

type FormValues = z.infer<typeof schema>;

function nowMs() {
  return Date.now();
}
const pad = (n: number) => String(n).padStart(2, "0");
function toLocalInput(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
function defaultValues(): FormValues {
  const start = new Date(nowMs() + 30 * 60_000);
  start.setMinutes(start.getMinutes() < 30 ? 30 : 60, 0, 0);
  const end = new Date(start.getTime() + 7 * 86400_000);
  return {
    title: "",
    rules: "",
    token: "USDC",
    pool: "",
    start: toLocalInput(start),
    end: toLocalInput(end),
    delay: "604800",
    capPct: "20",
    minViews: "1000",
  };
}
const toUnix = (local: string) => Math.floor(new Date(local).getTime() / 1000);
const localMs = (local: string) => new Date(local).getTime();
const DURATIONS = [
  { ms: 30 * 60_000, label: "30 min" },
  { ms: 60 * 60_000, label: "1 hour" },
  { ms: 24 * 3600_000, label: "24 hours" },
  { ms: 7 * 86400_000, label: "7 days" },
] as const;

// ── progress ──
type FlowKey = CreateStep | "publishing" | "done";
const FLOW: { key: FlowKey; label: string }[] = [
  { key: "checking", label: "Check token balance" },
  { key: "signing", label: "Sign the permit (free, no gas)" },
  { key: "creating", label: "Create & fund the campaign" },
  { key: "confirming", label: "Confirm on Arc" },
  { key: "publishing", label: "Publish title & rules" },
];

interface FlowState {
  step: FlowKey;
  fallback: boolean;
  approveTx?: Hash;
  createTx?: Hash;
  campaignId?: string;
  error?: string;
}

function ProgressPanel({ flow, onRetryMeta, onClose }: { flow: FlowState; onRetryMeta: () => void; onClose: () => void }) {
  const steps = flow.fallback
    ? [FLOW[0], { key: "approving" as FlowKey, label: "Approve the token (fallback)" }, ...FLOW.slice(2)]
    : FLOW;
  const idx = flow.step === "done" ? steps.length : steps.findIndex((s) => s.key === flow.step);
  return (
    <div className="space-y-4 rounded-xl border bg-background/60 p-4" aria-live="polite">
      <ol className="space-y-3">
        {steps.map((s, i) => {
          const done = i < idx;
          const active = i === idx && !flow.error;
          const failed = i === idx && !!flow.error;
          return (
            <li key={s.key} className="flex items-center gap-3 text-sm">
              <span
                className={cn(
                  "flex size-6 shrink-0 items-center justify-center rounded-full border",
                  done && "border-success bg-success text-success-foreground",
                  active && "border-primary",
                  failed && "border-destructive text-destructive",
                )}
              >
                {done ? (
                  <CheckIcon className="size-3.5" aria-hidden />
                ) : active ? (
                  <LoaderCircleIcon className="size-3.5 animate-spin text-primary" aria-hidden />
                ) : failed ? (
                  <CircleAlertIcon className="size-3.5" aria-hidden />
                ) : (
                  <span className="text-[0.65rem] text-muted-foreground num">{i + 1}</span>
                )}
              </span>
              <span className={cn(done || active ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
              {s.key === "approving" && flow.approveTx && <TxLink hash={flow.approveTx} label="tx" className="ml-auto" />}
              {s.key === "creating" && flow.createTx && <TxLink hash={flow.createTx} label="tx" className="ml-auto" />}
            </li>
          );
        })}
      </ol>
      {flow.error && (
        <Alert variant="destructive">
          <CircleAlertIcon aria-hidden />
          <AlertTitle>{flow.campaignId ? "Campaign created, but details weren't saved" : "Campaign not created"}</AlertTitle>
          <AlertDescription>{flow.error}</AlertDescription>
        </Alert>
      )}
      {flow.error && (
        <div className="flex flex-wrap gap-2">
          {flow.campaignId ? (
            <>
              <Button size="sm" onClick={onRetryMeta}>
                <RotateCwIcon aria-hidden /> Retry publishing details
              </Button>
              <Link href={`/c/${flow.campaignId}`} className={buttonVariants({ size: "sm", variant: "outline" })}>
                Go to campaign #{flow.campaignId}
              </Link>
            </>
          ) : (
            <Button size="sm" variant="outline" onClick={onClose}>
              Edit and try again
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

// ── form ──
function Field({
  id,
  label,
  hint,
  error,
  children,
  aside,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
  aside?: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium num">{children}</dd>
    </div>
  );
}

function CreateForm() {
  const router = useRouter();
  const uid = useId();
  const id = (name: string) => `${uid}-${name}`;
  const { address, chainId, isConnected } = useConnection();
  const switchChain = useSwitchChain();
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [meta, setMeta] = useState<{ title: string; rules: string } | null>(null);

  const [initialValues] = useState(defaultValues);
  const form = useForm<FormValues>({ resolver: zodResolver(schema), defaultValues: initialValues, mode: "onTouched" });
  const { register, handleSubmit, control, formState, setValue, setError } = form;
  const windows = useContractWindows();
  const presets = delayPresets(windows.minMeasurementDelay);
  const errors = formState.errors;
  const v = useWatch({ control });

  // Keep the campaign length when the opening time moves; quick "now" + duration helpers.
  const [lastStart, setLastStart] = useState(initialValues.start);
  const moveStart = (nextStart: string) => {
    const prev = localMs(lastStart);
    const next = localMs(nextStart);
    const end = localMs(form.getValues("end"));
    if (Number.isFinite(prev) && Number.isFinite(next) && Number.isFinite(end) && end > prev) {
      setValue("end", toLocalInput(new Date(next + (end - prev))), { shouldValidate: true, shouldDirty: true });
    }
    setLastStart(nextStart);
  };
  const startNow = () => {
    const now = toLocalInput(new Date(nowMs()));
    setValue("start", now, { shouldValidate: true, shouldDirty: true });
    moveStart(now);
  };
  const setDuration = (ms: number) => {
    const start = localMs(form.getValues("start"));
    if (Number.isFinite(start)) setValue("end", toLocalInput(new Date(start + ms)), { shouldValidate: true, shouldDirty: true });
  };
  const durationMs = localMs(v.end ?? "") - localMs(v.start ?? "");

  const symbol = (v.token ?? "USDC") as TokenSymbol;
  const tokenAddress = TOKENS[chainKey][symbol];
  const pool = safePool(v.pool ?? "");
  const capBps = Math.round(Number(v.capPct || 0) * 100);
  const capAmount = capBps > 0 ? (pool * BigInt(Math.min(capBps, 10000))) / 10000n : 0n;
  const startUnix = v.start ? toUnix(v.start) : NaN;
  const endUnix = v.end ? toUnix(v.end) : NaN;
  const delay = Number(v.delay ?? 604800);
  const snapshotUnix = Number.isNaN(endUnix) ? NaN : endUnix + delay;

  const balanceQ = useReadContract({
    address: tokenAddress,
    abi: erc20PermitAbi,
    functionName: "balanceOf",
    args: address ? [address] : undefined,
    chainId: activeChain.id,
    query: { enabled: Boolean(address) && !USE_MOCKS },
  });
  const balance = USE_MOCKS && address ? 25_000n * 10n ** 6n : balanceQ.data;
  const insufficient = balance !== undefined && pool > 0n && pool > balance;
  const wrongNetwork = isConnected && chainId !== activeChain.id;
  const busy = flow !== null && !flow.error;
  const noContract = !CLIPPOOL && !USE_MOCKS;

  const publishMeta = async (campaignId: string, createTx: Hash, m: { title: string; rules: string }) => {
    setFlow((f) => (f ? { ...f, step: "publishing", error: undefined } : f));
    let lastErr: unknown;
    // The backend verifies the rules hash against the indexed campaign; give the indexer a moment.
    for (let attempt = 0; attempt < 4; attempt++) {
      try {
        await api.postMeta(campaignId, { title: m.title, rules: m.rules, createTx });
        setFlow((f) => (f ? { ...f, step: "done" } : f));
        toast.success(`Campaign #${campaignId} is live`);
        router.push(`/c/${campaignId}`);
        return;
      } catch (err) {
        lastErr = err;
        await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
      }
    }
    setFlow((f) => (f ? { ...f, error: humanizeError(lastErr) } : f));
  };

  const onSubmit = handleSubmit(async (values) => {
    if (Number(values.delay) < windows.minMeasurementDelay) {
      setError("delay", { message: `The contract requires at least ${formatDelay(windows.minMeasurementDelay)}.` });
      return;
    }
    const m = { title: values.title.trim(), rules: values.rules.trim() };
    setMeta(m);
    setFlow({ step: "checking", fallback: false });

    if (USE_MOCKS) {
      // Demo mode: simulate the flow without touching a wallet.
      const fake = rulesHashOf(m.rules + nowMs()) as Hash;
      for (const step of ["checking", "signing", "creating", "confirming"] as const) {
        setFlow((f) => (f ? { ...f, step, createTx: step === "confirming" ? fake : f.createTx } : f));
        await new Promise((r) => setTimeout(r, 700));
      }
      setFlow((f) => (f ? { ...f, campaignId: "4" } : f));
      await publishMeta("4", fake, m);
      return;
    }

    if (!CLIPPOOL || !address) return;
    try {
      const { id: newId, hash } = await createCampaignOnchain(
        {
          clipPool: CLIPPOOL,
          account: address as Address,
          token: tokenAddress,
          pool: parseUnits(values.pool, TOKEN_DECIMALS),
          startTime: BigInt(toUnix(values.start)),
          endTime: BigInt(toUnix(values.end)),
          measurementDelay: BigInt(values.delay),
          maxShareBps: Math.round(Number(values.capPct) * 100),
          minViews: Number(values.minViews),
          rules: m.rules,
        },
        {
          onStep: (step) => setFlow((f) => (f ? { ...f, step } : f)),
          onTx: (hash, kind) =>
            setFlow((f) => (f ? { ...f, ...(kind === "approve" ? { approveTx: hash } : { createTx: hash }) } : f)),
          onFallback: () => {
            setFlow((f) => (f ? { ...f, fallback: true } : f));
            toast.info("Your wallet couldn't sign a permit. Falling back to approve + create (two transactions).");
          },
        },
      );
      const cid = newId.toString();
      setFlow((f) => (f ? { ...f, campaignId: cid, createTx: hash } : f));
      await publishMeta(cid, hash, m);
    } catch (err) {
      const msg =
        err instanceof InsufficientBalanceError
          ? `You have ${formatToken(err.balance, symbol)} but the pool needs ${formatToken(err.needed, symbol)}.`
          : humanizeError(err);
      if (isUserRejection(err)) toast.message("Request cancelled in your wallet.");
      setFlow((f) => (f ? { ...f, error: msg } : { step: "checking", fallback: false, error: msg }));
    }
  });

  return (
    <form onSubmit={onSubmit} noValidate className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="space-y-8">
        <fieldset disabled={busy} className="space-y-6 rounded-2xl border bg-card p-5 sm:p-6">
          <legend className="sr-only">Campaign brief</legend>
          <h2 className="text-lg font-semibold">The brief</h2>
          <Field id={id("title")} label="Campaign title" error={errors.title?.message} hint="Shown to creators on the campaign page.">
            <Input
              id={id("title")}
              placeholder="e.g. Arc Launch Week: Shorts Challenge"
              className="h-10"
              aria-invalid={errors.title ? true : undefined}
              aria-describedby={errors.title ? `${id("title")}-error` : `${id("title")}-hint`}
              {...register("title")}
            />
          </Field>
          <Field
            id={id("rules")}
            label="Rules"
            error={errors.rules?.message}
            hint="What qualifies, tone, disclosure requirements. The hash is stored onchain so rules can't change later."
            aside={<span className="text-xs text-muted-foreground num">{formatInt((v.rules ?? "").length)} / 5,000</span>}
          >
            <Textarea
              id={id("rules")}
              rows={7}
              placeholder={"Make a YouTube Short (≤ 3 min) about …\n• Include your cp- binding code in the description\n• Original content only, no botted views\n• Use YouTube's paid-promotion disclosure"}
              aria-invalid={errors.rules ? true : undefined}
              aria-describedby={errors.rules ? `${id("rules")}-error` : `${id("rules")}-hint`}
              {...register("rules")}
            />
          </Field>
        </fieldset>

        <fieldset disabled={busy} className="space-y-6 rounded-2xl border bg-card p-5 sm:p-6">
          <legend className="sr-only">Pool</legend>
          <h2 className="text-lg font-semibold">The pool</h2>
          <div className="grid gap-5 sm:grid-cols-[10rem_1fr]">
            <Field id={id("token")} label="Token">
              <Controller
                control={control}
                name="token"
                render={({ field }) => (
                  <Select value={field.value} onValueChange={(val) => val && field.onChange(val)}>
                    <SelectTrigger id={id("token")} className="h-10 w-full" aria-label="Token">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {(["USDC", "EURC"] as const).map((t) => (
                        <SelectItem key={t} value={t}>
                          <TokenIcon symbol={t} /> {t}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
              />
            </Field>
            <Field
              id={id("pool")}
              label="Pool amount"
              error={errors.pool?.message ?? (insufficient ? `Not enough ${symbol} in the connected wallet.` : undefined)}
              hint={`The full amount is escrowed in the ClipPool contract and split among creators.`}
              aside={
                address && balance !== undefined ? (
                  <button
                    type="button"
                    className="text-xs text-muted-foreground hover:text-foreground"
                    onClick={() =>
                      setValue("pool", formatUnits(balance, TOKEN_DECIMALS), { shouldValidate: true, shouldTouch: true })
                    }
                  >
                    Balance: <span className="num">{formatToken(balance, symbol)}</span>
                  </button>
                ) : null
              }
            >
              <div className="relative">
                <Input
                  id={id("pool")}
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder="1000.00"
                  className="h-10 pr-16 text-base num"
                  aria-invalid={errors.pool || insufficient ? true : undefined}
                  aria-describedby={errors.pool || insufficient ? `${id("pool")}-error` : `${id("pool")}-hint`}
                  {...register("pool")}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  {symbol}
                </span>
              </div>
            </Field>
          </div>
        </fieldset>

        <fieldset disabled={busy} className="space-y-6 rounded-2xl border bg-card p-5 sm:p-6">
          <legend className="sr-only">Schedule and fairness rules</legend>
          <h2 className="text-lg font-semibold">Schedule</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field id={id("start")} label="Submissions open" error={errors.start?.message}>
              <Input
                id={id("start")}
                type="datetime-local"
                className="h-10"
                aria-invalid={errors.start ? true : undefined}
                aria-describedby={errors.start ? `${id("start")}-error` : undefined}
                {...register("start", { deps: ["end"], onChange: (e) => moveStart(e.target.value) })}
              />
              <button type="button" onClick={startNow} className="mt-1.5 text-xs font-medium text-primary hover:underline">
                Open now
              </button>
            </Field>
            <Field id={id("end")} label="Submissions close" error={errors.end?.message}>
              <Input
                id={id("end")}
                type="datetime-local"
                className="h-10"
                aria-invalid={errors.end ? true : undefined}
                aria-describedby={errors.end ? `${id("end")}-error` : undefined}
                {...register("end")}
              />
              <div className="mt-1.5 flex flex-wrap gap-1.5" role="group" aria-label="Campaign length">
                {DURATIONS.map((d) => (
                  <button
                    key={d.ms}
                    type="button"
                    onClick={() => setDuration(d.ms)}
                    aria-pressed={durationMs === d.ms}
                    className={cn(
                      "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
                      durationMs === d.ms ? "border-primary bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d.label}
                  </button>
                ))}
              </div>
            </Field>
          </div>
          <div className="space-y-2">
            <p id={id("delay")} className="text-sm font-medium">
              Measurement delay
            </p>
            <p className="text-xs text-muted-foreground">How long views keep counting after submissions close, before the snapshot.</p>
            <Controller
              control={control}
              name="delay"
              render={({ field }) => (
                <div
                  role="radiogroup"
                  aria-labelledby={id("delay")}
                  className={cn("grid gap-2", presets.length > 3 ? "grid-cols-2 sm:grid-cols-4" : "grid-cols-3")}
                >
                  {presets.map((d) => {
                    const checked = field.value === d.value;
                    return (
                      <button
                        key={d.value}
                        type="button"
                        role="radio"
                        aria-checked={checked}
                        onClick={() => field.onChange(d.value)}
                        className={cn(
                          "rounded-xl border px-3 py-2.5 text-left transition-colors focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
                          checked ? "border-primary bg-primary/12" : "hover:bg-muted",
                        )}
                      >
                        <span className="block text-sm font-medium">{d.label}</span>
                        <span className="block text-xs text-muted-foreground">{d.hint}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            />
            {errors.delay?.message && (
              <p role="alert" className="text-xs text-destructive">
                {errors.delay.message}
              </p>
            )}
          </div>

          <h2 className="pt-2 text-lg font-semibold">Fairness</h2>
          <div className="grid gap-5 sm:grid-cols-2">
            <Field
              id={id("cap")}
              label="Per-creator cap"
              error={errors.capPct?.message}
              hint={pool > 0n ? `At most ${formatToken(capAmount, symbol)} per creator.` : "Share of the pool one creator can earn."}
            >
              <div className="relative">
                <Input
                  id={id("cap")}
                  inputMode="decimal"
                  className="h-10 pr-8 num"
                  aria-invalid={errors.capPct ? true : undefined}
                  aria-describedby={errors.capPct ? `${id("cap")}-error` : `${id("cap")}-hint`}
                  {...register("capPct")}
                />
                <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground">
                  %
                </span>
              </div>
            </Field>
            <Field
              id={id("minViews")}
              label="Minimum views per Short"
              error={errors.minViews?.message}
              hint="Shorts below this at the snapshot don't count."
            >
              <Input
                id={id("minViews")}
                inputMode="numeric"
                className="h-10 num"
                aria-invalid={errors.minViews ? true : undefined}
                aria-describedby={errors.minViews ? `${id("minViews")}-error` : `${id("minViews")}-hint`}
                {...register("minViews")}
              />
            </Field>
          </div>
        </fieldset>
      </div>

      {/* Summary + action */}
      <aside className="lg:sticky lg:top-24 lg:self-start">
        <div className="space-y-5 rounded-2xl border bg-card p-5">
          <div>
            <p className="text-xs tracking-wide text-muted-foreground uppercase">You&apos;re locking</p>
            <p className="mt-1 flex items-center gap-2 text-3xl font-semibold tracking-tight num">
              <TokenIcon symbol={symbol} className="size-6 text-xs" />
              {formatToken(pool)} <span className="text-base font-medium text-muted-foreground">{symbol}</span>
            </p>
            <p className="mt-1 line-clamp-2 text-sm text-muted-foreground">{v.title?.trim() || "Untitled campaign"}</p>
          </div>
          <dl className="divide-y border-y">
            <SummaryRow label="Opens">{Number.isNaN(startUnix) ? "—" : formatDateTime(startUnix)}</SummaryRow>
            <SummaryRow label="Closes">{Number.isNaN(endUnix) ? "—" : formatDateTime(endUnix)}</SummaryRow>
            <SummaryRow label="View snapshot">
              {Number.isNaN(snapshotUnix) ? "—" : formatDateTime(snapshotUnix)}
              <span className="block text-xs font-normal text-muted-foreground">+{formatDelay(delay)} after close</span>
            </SummaryRow>
            <SummaryRow label="Earliest payout">
              {Number.isNaN(snapshotUnix) ? "—" : formatDateTime(snapshotUnix + windows.disputeWindow)}
              <span className="block text-xs font-normal text-muted-foreground">
                after the dispute window ({formatDelay(windows.disputeWindow)})
              </span>
            </SummaryRow>
            <SummaryRow label="Cap per creator">
              {v.capPct || "—"}%{pool > 0n && <span className="block text-xs font-normal text-muted-foreground">{formatToken(capAmount, symbol)}</span>}
            </SummaryRow>
            <SummaryRow label="Min views">{formatInt(Number(v.minViews || 0))}</SummaryRow>
            <SummaryRow label="Rules hash">
              <span className="font-mono text-xs">{(v.rules ?? "").trim() ? shortHash(rulesHashOf((v.rules ?? "").trim())) : "—"}</span>
            </SummaryRow>
          </dl>
          <p className="flex items-start gap-2 text-xs text-muted-foreground">
            <InfoIcon className="mt-px size-3.5 shrink-0" aria-hidden />
            Unspent cap overflow is refunded to you after payout. If no split is posted within 14 days of the snapshot, you can
            reclaim the full pool.
          </p>

          {flow ? (
            <ProgressPanel
              flow={flow}
              onClose={() => setFlow(null)}
              onRetryMeta={() => flow.campaignId && flow.createTx && meta && publishMeta(flow.campaignId, flow.createTx, meta)}
            />
          ) : noContract ? (
            <Alert>
              <SettingsIcon aria-hidden />
              <AlertTitle>Contract not configured</AlertTitle>
              <AlertDescription>
                Set <code className="font-mono">NEXT_PUBLIC_CLIPPOOL_ADDRESS</code> in the root <code>.env</code> after deploying
                ClipPool, then restart the app.
              </AlertDescription>
            </Alert>
          ) : !isConnected && !USE_MOCKS ? (
            <div className="space-y-2">
              <ConnectButton className="h-11 w-full" size="lg" />
              <p className="text-center text-xs text-muted-foreground">MetaMask, Rabby or any browser wallet.</p>
            </div>
          ) : wrongNetwork ? (
            <Button
              type="button"
              size="lg"
              variant="outline"
              className="h-11 w-full"
              disabled={switchChain.isPending}
              onClick={() => switchChain.mutate({ chainId: activeChain.id }, { onError: (e) => toast.error(humanizeError(e)) })}
            >
              <WalletIcon aria-hidden /> Switch to {activeChain.name}
            </Button>
          ) : (
            <div className="space-y-2">
              <Button type="submit" size="lg" className="h-11 w-full" disabled={insufficient || busy}>
                <LockIcon aria-hidden /> {pool > 0n ? `Lock ${formatToken(pool, symbol)}` : "Create campaign"}
              </Button>
              <p className="text-center text-xs text-muted-foreground">
                {USE_MOCKS ? "Demo mode: the transaction is simulated." : "One signature + one transaction. Network fee ≈ $0.01 in USDC."}
              </p>
            </div>
          )}
        </div>
      </aside>
    </form>
  );
}

export function CreateCampaignForm() {
  const mounted = useMounted();
  // Default dates depend on the current time, so the form renders on the client only.
  if (!mounted) {
    return (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_22rem]" aria-busy="true" aria-label="Loading form">
        <div className="space-y-8">
          <Skeleton className="h-80 rounded-2xl" />
          <Skeleton className="h-40 rounded-2xl" />
        </div>
        <Skeleton className="h-[30rem] rounded-2xl" />
      </div>
    );
  }
  return <CreateForm />;
}
