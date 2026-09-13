import { cn } from "@/lib/utils";

export function StxMark({ className }: { className?: string }) {
  return (
    <img
      src="/stx-logo.png"
      alt=""
      className={cn("h-9 w-auto", className)}
    />
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
    <div
      className={cn(
        "inline-flex items-center rounded-md",
        inverted ? "bg-white px-2 py-1.5" : "bg-white px-1",
      )}
    >
      <img
        src="/stx-logo.png"
        alt="STX Corporation — Railroad Construction Services"
        className={cn("w-auto", variant === "compact" ? "h-8" : "h-11")}
      />
    </div>
  );
}
