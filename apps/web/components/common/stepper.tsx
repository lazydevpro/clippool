import { CheckIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export function Stepper({ steps, current }: { steps: string[]; current: number }) {
  return (
    <ol className="flex items-center gap-2 sm:gap-3" aria-label="Progress">
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <li key={label} className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3" aria-current={active ? "step" : undefined}>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-semibold num transition-colors",
                done && "border-primary bg-primary text-primary-foreground",
                active && "border-primary bg-primary/15 text-foreground ring-4 ring-primary/15",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? <CheckIcon className="size-3.5" aria-hidden /> : i + 1}
              <span className="sr-only">{done ? " (completed)" : active ? " (current)" : ""}</span>
            </span>
            <span className={cn("truncate text-sm", active ? "font-medium text-foreground" : "text-muted-foreground", "hidden sm:inline")}>
              {label}
            </span>
            {i < steps.length - 1 && <span className={cn("h-px flex-1", done ? "bg-primary" : "bg-border")} aria-hidden />}
          </li>
        );
      })}
    </ol>
  );
}
