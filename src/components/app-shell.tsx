import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function AppShell({
  children,
  footer,
}: {
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-navy-deep">
      <div className="relative mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-background text-foreground shadow-shell">
        {children}
        {footer ? <div className="sticky bottom-0 z-20 mt-auto">{footer}</div> : null}
      </div>
    </div>
  );
}

export function ShellHeader({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("bg-navy pt-safe text-paper-bright", className)}>
      <div className="px-5 pt-4 pb-4">{children}</div>
      <div className="rail-rule" />
    </header>
  );
}
