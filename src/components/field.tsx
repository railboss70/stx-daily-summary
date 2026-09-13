import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function Field({
  label,
  hint,
  error,
  children,
  className,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <span className="font-display text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </span>
      {children}
      {error ? <span className="text-sm text-danger">{error}</span> : null}
      {!error && hint ? <span className="text-sm text-muted-foreground">{hint}</span> : null}
    </div>
  );
}

export function SectionCard({
  title,
  children,
  action,
}: {
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section className="overflow-hidden rounded-xl bg-card shadow-card">
      <header className="flex items-center justify-between gap-3 bg-navy px-4 py-2.5">
        <h2 className="font-display text-base font-semibold uppercase tracking-[0.14em] text-paper-bright">
          {title}
        </h2>
        {action}
      </header>
      <div className="flex flex-col gap-4 p-4">{children}</div>
    </section>
  );
}
