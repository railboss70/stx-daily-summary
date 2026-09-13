import { cn } from "@/lib/utils";

export function StxMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      className={cn("shrink-0", className)}
      aria-hidden="true"
      fill="none"
    >
      <polygon points="24,3 45,44 3,44" fill="currentColor" />
      <polygon points="24,16 35,38 13,38" fill="var(--color-navy)" />
      <rect x="21.5" y="22" width="5" height="10" fill="currentColor" />
    </svg>
  );
}

export function StxLogo({
  variant = "full",
  inverted = false,
}: {
  variant?: "full" | "compact";
  inverted?: boolean;
}) {
  return (
    <div className={cn("flex items-center gap-3", inverted ? "text-paper-bright" : "text-navy")}>
      <StxMark className={cn(variant === "compact" ? "size-9" : "size-11", inverted && "text-paper-bright")} />
      <div className="leading-none">
        <div
          className={cn(
            "font-display font-semibold tracking-[0.12em]",
            variant === "compact" ? "text-2xl" : "text-3xl",
          )}
        >
          STX
        </div>
        <div
          className={cn(
            "mt-1 font-semibold uppercase tracking-[0.22em]",
            variant === "compact" ? "text-xs" : "text-xs",
            inverted ? "text-paper-bright/70" : "text-muted-foreground",
          )}
        >
          Corporation
        </div>
      </div>
    </div>
  );
}
