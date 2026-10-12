"use client";

import { CheckIcon, CopyIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useCopy } from "@/hooks/use-copy";
import { cn } from "@/lib/utils";

export function CopyButton({
  value,
  label = "Copy",
  toastLabel,
  className,
  size = "icon-xs",
  showLabel = false,
}: {
  value: string;
  label?: string;
  toastLabel?: string;
  className?: string;
  size?: "icon-xs" | "icon-sm" | "icon" | "sm" | "default" | "lg";
  showLabel?: boolean;
}) {
  const { copied, copy } = useCopy();
  return (
    <Button
      type="button"
      variant={showLabel ? "outline" : "ghost"}
      size={size}
      className={cn(!showLabel && "text-muted-foreground hover:text-foreground", className)}
      onClick={() => copy(value, toastLabel)}
      aria-label={copied ? "Copied" : label}
    >
      {copied ? <CheckIcon className="text-success" aria-hidden /> : <CopyIcon aria-hidden />}
      {showLabel && <span>{copied ? "Copied" : label}</span>}
    </Button>
  );
}
