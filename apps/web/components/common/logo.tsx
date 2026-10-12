import { cn } from "@/lib/utils";

/** ClipPool mark: a pool split into proportional bars. */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={cn("size-7", className)} aria-hidden>
      <rect width="32" height="32" rx="9" fill="#3E74BB" />
      <rect x="7" y="17" width="4" height="8" rx="1.5" fill="#ACC6E9" />
      <rect x="14" y="11" width="4" height="14" rx="1.5" fill="#FFFFFF" />
      <rect x="21" y="7" width="4" height="18" rx="1.5" fill="#ACC6E9" />
    </svg>
  );
}

export function Logo({ className }: { className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2 font-semibold tracking-tight", className)}>
      <LogoMark />
      <span className="text-[1.05rem]">ClipPool</span>
    </span>
  );
}
