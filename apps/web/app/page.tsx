import type { Metadata } from "next";
import Link from "next/link";
import {
  ArrowRightIcon,
  BadgeCheckIcon,
  CoinsIcon,
  FileCheck2Icon,
  GaugeIcon,
  LinkIcon,
  LockIcon,
  ScaleIcon,
  ShieldCheckIcon,
  SparklesIcon,
  UploadIcon,
  WalletIcon,
  ZapIcon,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { CampaignGrid } from "@/components/campaign/campaign-grid";
import { cn } from "@/lib/utils";

export const metadata: Metadata = {
  title: { absolute: "ClipPool: get paid for every view, fairly" },
  description:
    "Pro-rata creator campaigns on Arc. Brands lock a USDC pool, creators post YouTube Shorts, and the pool is split by views and paid instantly onchain.",
};

const SPLIT = [
  { name: "Priya Shorts", views: "412K", pct: 20, amount: "1,000.00", capped: true },
  { name: "OnchainOli", views: "269K", pct: 18.4, amount: "920.40" },
  { name: "LatAm Ledger", views: "197K", pct: 13.5, amount: "674.95" },
  { name: "Manila Minutes", views: "155K", pct: 10.6, amount: "530.03" },
  { name: "+ 8 more creators", views: "438K", pct: 37.5, amount: "1,874.62", muted: true },
];

function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md lg:mx-0">
      <div className="absolute -inset-6 rounded-[2rem] bg-primary/20 blur-3xl" aria-hidden />
      <figure className="relative rounded-2xl border bg-card/90 p-5 shadow-2xl shadow-black/20 backdrop-blur">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Example split</p>
            <p className="mt-0.5 font-semibold">Arc Launch Week</p>
          </div>
          <div className="text-right">
            <p className="text-xs text-muted-foreground">Pool</p>
            <p className="font-semibold num">5,000.00 USDC</p>
          </div>
        </div>
        <ul className="mt-5 space-y-3.5" aria-label="Example allocation by views">
          {SPLIT.map((r) => (
            <li key={r.name} className="space-y-1.5">
              <div className="flex items-center justify-between gap-3 text-sm">
                <span className={cn("truncate", r.muted && "text-muted-foreground")}>
                  {r.name}
                  {r.capped && (
                    <span className="ml-2 rounded-full bg-warning/15 px-1.5 py-0.5 text-[0.65rem] font-medium text-warning">
                      20% cap
                    </span>
                  )}
                </span>
                <span className="shrink-0 font-medium num">{r.amount}</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <div
                    className={cn("h-full rounded-full", r.muted ? "bg-brand-soft/40" : "bg-gradient-to-r from-primary to-brand-soft")}
                    style={{ width: `${(r.pct / 37.5) * 100 * 0.95}%` }}
                  />
                </div>
                <span className="w-16 text-right text-xs text-muted-foreground num">{r.views} views</span>
              </div>
            </li>
          ))}
        </ul>
        <figcaption className="mt-5 flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2.5 text-xs">
          <span className="flex items-center gap-1.5 text-success">
            <ZapIcon className="size-3.5" aria-hidden /> 12 payouts settled in under a second
          </span>
          <span className="text-muted-foreground num">≈ $0.001 each</span>
        </figcaption>
      </figure>
    </div>
  );
}

const BRAND_STEPS = [
  { icon: LockIcon, title: "Lock a pool", body: "Fund a USDC or EURC pool in one transaction with a permit signature. No approve step." },
  { icon: FileCheck2Icon, title: "Set the rules", body: "Window, per-creator cap, minimum views. Rules are hashed onchain so they can't change later." },
  { icon: GaugeIcon, title: "Pay only for traction", body: "The whole pool goes to creators by views. Cap overflow and dust are refunded to you." },
];
const CREATOR_STEPS = [
  { icon: SparklesIcon, title: "Post a Short", body: "Add your personal cp- code to the description. It proves the video is yours." },
  { icon: UploadIcon, title: "Submit the link", body: "Paste the URL with your payout wallet. No gas, no signup fee, just an address." },
  { icon: WalletIcon, title: "Get paid automatically", body: "After the snapshot and a 48h dispute window, USDC lands in your wallet. No claiming." },
];

const WHY_ARC = [
  {
    icon: ZapIcon,
    title: "Instant USDC payouts",
    body: "Sub-second finality means creators see stablecoins in their wallet moments after the dispute window closes, in any country.",
  },
  {
    icon: CoinsIcon,
    title: "~$0.001 per transfer",
    body: "Gas is paid in USDC on Arc, so paying a hundred creators costs cents. No volatile gas token to manage.",
  },
  {
    icon: ScaleIcon,
    title: "A split anyone can verify",
    body: "A Merkle root of every payout is posted onchain. Re-run the open-source script on the snapshot and get the same root.",
  },
];

const FAIRNESS = [
  { icon: BadgeCheckIcon, title: "The budget is always fully spent", body: "No first-come race. Late creators with great posts still earn their share." },
  { icon: ShieldCheckIcon, title: "Brands can't claw it back", body: "Once live, the pool is escrowed by the contract. Refunds follow fixed rules only." },
  { icon: ScaleIcon, title: "Rejecting a creator saves the brand nothing", body: "A removed share is redistributed to other creators, not refunded." },
];

function StepList({ label, steps, accent }: { label: string; steps: typeof BRAND_STEPS; accent: string }) {
  return (
    <div className="rounded-2xl border bg-card p-6 sm:p-8">
      <p className={cn("text-xs font-semibold tracking-widest uppercase", accent)}>{label}</p>
      <ol className="mt-6 space-y-6">
        {steps.map((s, i) => (
          <li key={s.title} className="flex gap-4">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-xl border bg-muted/60">
              <s.icon className="size-5 text-primary dark:text-brand-soft" aria-hidden />
            </span>
            <div>
              <h3 className="font-medium">
                <span className="mr-2 text-muted-foreground num">{i + 1}.</span>
                {s.title}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export default function Home() {
  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden border-b">
        <div className="bg-hero-glow absolute inset-0" aria-hidden />
        <div
          className="bg-grid absolute inset-0 [mask-image:radial-gradient(70%_60%_at_50%_0%,black,transparent)]"
          aria-hidden
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.1fr_1fr] lg:py-28">
          <div className="animate-in duration-500 fade-in slide-in-from-bottom-2">
            <p className="inline-flex items-center gap-2 rounded-full border bg-card/60 px-3 py-1 text-xs text-muted-foreground backdrop-blur">
              <span className="size-1.5 rounded-full bg-success" aria-hidden />
              Pro-rata creator campaigns on Arc · USDC &amp; EURC
            </p>
            <h1 className="mt-6 text-4xl leading-[1.05] font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Get paid for every view. <span className="text-gradient">Fairly.</span>
            </h1>
            <p className="mt-6 max-w-xl text-lg text-pretty text-muted-foreground">
              Brands lock a stablecoin pool. Creators post YouTube Shorts. When the campaign ends, the pool is split by
              views, with a per-creator cap, and paid out instantly onchain.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link href="/campaigns/new" className={buttonVariants({ size: "lg", className: "h-11 px-5 text-sm" })}>
                Launch a campaign <ArrowRightIcon aria-hidden />
              </Link>
              <Link
                href="#campaigns"
                className={buttonVariants({ size: "lg", variant: "outline", className: "h-11 px-5 text-sm" })}
              >
                Browse live campaigns
              </Link>
            </div>
            <ul className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-muted-foreground">
              {["No gas for creators", "No signup fee", "Verifiable split"].map((t) => (
                <li key={t} className="flex items-center gap-1.5">
                  <BadgeCheckIcon className="size-4 text-success" aria-hidden /> {t}
                </li>
              ))}
            </ul>
          </div>
          <div className="animate-in delay-150 duration-700 fade-in slide-in-from-bottom-4 fill-mode-both">
            <HeroVisual />
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="how">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-primary dark:text-brand-soft">How it works</p>
          <h2 id="how" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            One pool. Every view counts.
          </h2>
          <p className="mt-3 text-muted-foreground">
            Your payout is the pool times your share of total views, capped so no single creator takes it all.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <StepList label="For brands" steps={BRAND_STEPS} accent="text-primary dark:text-brand-soft" />
          <StepList label="For creators" steps={CREATOR_STEPS} accent="text-success" />
        </div>
      </section>

      {/* Live campaigns */}
      <section id="campaigns" className="scroll-mt-24 border-y bg-card/30" aria-labelledby="campaigns-title">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className="text-sm font-medium text-primary dark:text-brand-soft">Campaigns</p>
              <h2 id="campaigns-title" className="mt-2 text-3xl font-semibold tracking-tight">
                Pools you can earn from
              </h2>
            </div>
            <Link href="/campaigns/new" className={buttonVariants({ variant: "outline" })}>
              Start your own <ArrowRightIcon aria-hidden />
            </Link>
          </div>
          <div className="mt-8">
            <CampaignGrid />
          </div>
        </div>
      </section>

      {/* Why Arc */}
      <section className="mx-auto max-w-6xl px-4 py-20 sm:px-6" aria-labelledby="why-arc">
        <div className="max-w-2xl">
          <p className="text-sm font-medium text-primary dark:text-brand-soft">Why Arc</p>
          <h2 id="why-arc" className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">
            Built for paying lots of people, fast.
          </h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {WHY_ARC.map((f) => (
            <div key={f.title} className="rounded-2xl border bg-card p-6">
              <span className="flex size-10 items-center justify-center rounded-xl bg-primary/15">
                <f.icon className="size-5 text-primary dark:text-brand-soft" aria-hidden />
              </span>
              <h3 className="mt-5 font-semibold">{f.title}</h3>
              <p className="mt-2 text-sm text-muted-foreground">{f.body}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Fairness */}
      <section className="mx-auto max-w-6xl px-4 pb-8 sm:px-6" aria-labelledby="fair">
        <div className="grid gap-8 rounded-3xl border bg-gradient-to-br from-card to-background p-6 sm:p-10 lg:grid-cols-[1fr_1.2fr]">
          <div>
            <h2 id="fair" className="text-2xl font-semibold tracking-tight sm:text-3xl">
              Why a pool beats pay-per-view budgets
            </h2>
            <p className="mt-3 text-muted-foreground">
              Fixed CPM campaigns stop paying when the budget runs out and leave creators guessing. A pro-rata pool is
              predictable for brands and fair to every creator.
            </p>
            <div className="mt-6 rounded-xl border bg-background/60 p-4 font-mono text-sm">
              <p className="text-muted-foreground">your payout =</p>
              <p className="mt-1">
                min(<span className="text-primary dark:text-brand-soft">pool</span> ×{" "}
                <span className="text-success">your views</span> / all views, cap)
              </p>
            </div>
          </div>
          <ul className="grid gap-5">
            {FAIRNESS.map((f) => (
              <li key={f.title} className="flex gap-4">
                <f.icon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
                <div>
                  <h3 className="font-medium">{f.title}</h3>
                  <p className="mt-1 text-sm text-muted-foreground">{f.body}</p>
                </div>
              </li>
            ))}
            <li className="flex gap-4">
              <LinkIcon className="mt-0.5 size-5 shrink-0 text-success" aria-hidden />
              <div>
                <h3 className="font-medium">Honest about trust</h3>
                <p className="mt-1 text-sm text-muted-foreground">
                  Custody and payout limits are enforced by the contract. View counts come from our oracle, backed by a
                  published snapshot and a 48h dispute window.
                </p>
              </div>
            </li>
          </ul>
        </div>
      </section>
    </>
  );
}
