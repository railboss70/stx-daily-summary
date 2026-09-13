import { cn } from "@/lib/utils";
import type { YesNo } from "@/lib/types";

export function YesNo({
  value,
  onChange,
  label,
}: {
  value: YesNo;
  onChange: (v: YesNo) => void;
  label: string;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </p>
      <div className="grid grid-cols-2 gap-2" role="radiogroup" aria-label={label}>
        {(
          [
            ["yes", "Yes"],
            ["no", "No"],
          ] as const
        ).map(([v, text]) => {
          const selected = value === v;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => onChange(v)}
              className={cn(
                "flex h-12 min-h-12 items-center justify-center rounded-md border text-base font-semibold transition-colors duration-150",
                selected
                  ? "border-navy bg-navy text-paper-bright"
                  : "border-border bg-card text-foreground hover:bg-muted",
              )}
            >
              {text}
            </button>
          );
        })}
      </div>
    </div>
  );
}
