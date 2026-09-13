import { createFileRoute } from "@tanstack/react-router";
import { ReportWizard } from "@/components/report-wizard";
import { AppShell, ShellHeader } from "@/components/app-shell";
import { StxLogo } from "@/components/stx-logo";
import { useHasHydrated } from "@/lib/store";

export const Route = createFileRoute("/report/$id")({
  component: ReportPage,
});

function ReportPage() {
  const { id } = Route.useParams();
  const hydrated = useHasHydrated();

  if (!hydrated) {
    return (
      <AppShell>
        <ShellHeader>
          <StxLogo inverted variant="compact" />
        </ShellHeader>
        <main className="flex flex-1 items-center justify-center p-6">
          <p className="text-muted-foreground">Loading report…</p>
        </main>
      </AppShell>
    );
  }

  return <ReportWizard reportId={id} />;
}
