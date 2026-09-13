import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ClipboardList, Copy, Plus, Smartphone, Trash2 } from "lucide-react";
import { AppShell, ShellHeader } from "@/components/app-shell";
import { StxLogo } from "@/components/stx-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Field } from "@/components/field";
import { formatLongDate, formatShortDate, todayISO } from "@/lib/dates";
import { useHasHydrated, useReportStore } from "@/lib/store";
import type { Report } from "@/lib/types";
import { DEFAULT_EMAIL } from "@/lib/types";

export const Route = createFileRoute("/")({ component: Home });

function Home() {
  const navigate = useNavigate();
  const hydrated = useHasHydrated();
  const reports = useReportStore((s) => s.reports);
  const order = useReportStore((s) => s.order);
  const settings = useReportStore((s) => s.settings);
  const createReport = useReportStore((s) => s.createReport);
  const deleteReport = useReportStore((s) => s.deleteReport);
  const setSettings = useReportStore((s) => s.setSettings);

  const list = hydrated ? order.map((id) => reports[id]).filter((r): r is Report => Boolean(r)) : [];
  const today = todayISO();
  const todayDraft = list.find((r) => r.status === "draft" && r.date === today);
  const drafts = list.filter((r) => r.status === "draft");
  const sent = list.filter((r) => r.status === "sent");

  const openNew = (fromLast = false) => {
    if (todayDraft && !fromLast) {
      navigate({ to: "/report/$id", params: { id: todayDraft.id } });
      return;
    }
    const id = createReport(fromLast);
    navigate({ to: "/report/$id", params: { id } });
  };

  return (
    <AppShell>
      <ShellHeader>
        <StxLogo inverted />
        <p className="mt-3 font-display text-sm font-semibold uppercase tracking-[0.22em] text-brass">
          Railroad construction services
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-wide text-paper-bright">
          Daily Project Summary
        </h1>
        <p className="mt-2 text-paper-bright/75">
          {hydrated ? formatLongDate(today) : "\u00a0"}
        </p>
      </ShellHeader>

      <main className="flex flex-1 flex-col gap-5 px-4 py-5 pb-safe">
        <div className="flex flex-col gap-2">
          <Button size="lg" onClick={() => openNew(false)}>
            {todayDraft ? (
              <>
                <ClipboardList />
                Continue today's report
              </>
            ) : (
              <>
                <Plus />
                Start today's report
              </>
            )}
          </Button>
          {list.length > 0 ? (
            <Button variant="outline" onClick={() => openNew(true)}>
              <Copy />
              New from last crew
            </Button>
          ) : null}
          <Button variant="outline" asChild>
            <a href="/?install=1&platform=ios">
              <Smartphone />
              Add to iPhone home screen
            </a>
          </Button>
        </div>

        {!hydrated ? (
          <p className="text-sm text-muted-foreground">Loading saved reports…</p>
        ) : (
          <>
            <ReportGroup
              title="Drafts"
              empty="No drafts. Start a report for the shift."
              reports={drafts}
              onOpen={(id) => navigate({ to: "/report/$id", params: { id } })}
              onDelete={deleteReport}
            />
            <ReportGroup
              title="Sent"
              empty="Sent reports will land here after you share them."
              reports={sent}
              onOpen={(id) => navigate({ to: "/report/$id", params: { id } })}
              onDelete={deleteReport}
            />
          </>
        )}

        <section className="rounded-xl bg-card p-4 shadow-card">
          <h2 className="font-display text-base font-semibold uppercase tracking-[0.14em] text-navy">
            Supervisor defaults
          </h2>
          <div className="mt-3 flex flex-col gap-3">
            <Field label="Your name">
              <Input
                value={settings.defaultName}
                onChange={(e) => setSettings({ defaultName: e.target.value })}
                placeholder="Print name on reports"
                autoComplete="name"
                autoCapitalize="words"
              />
            </Field>
            <Field label="Send reports to" hint="Office default is reports@stxrailroad.com">
              <Input
                type="email"
                inputMode="email"
                value={settings.defaultEmail}
                onChange={(e) => setSettings({ defaultEmail: e.target.value })}
                placeholder={DEFAULT_EMAIL}
              />
            </Field>
          </div>
        </section>
      </main>
    </AppShell>
  );
}

function ReportGroup({
  title,
  empty,
  reports,
  onOpen,
  onDelete,
}: {
  title: string;
  empty: string;
  reports: Report[];
  onOpen: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  return (
    <section>
      <h2 className="mb-2 font-display text-sm font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        {title}
      </h2>
      {reports.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border bg-card px-4 py-5 text-sm text-muted-foreground">
          {empty}
        </p>
      ) : (
        <ul className="flex flex-col gap-2">
          {reports.map((report) => (
            <li key={report.id} className="flex items-stretch overflow-hidden rounded-lg bg-card shadow-card">
              <button
                type="button"
                onClick={() => onOpen(report.id)}
                className="flex min-h-16 flex-1 flex-col items-start px-4 py-3 text-left"
              >
                <span className="font-display text-lg font-semibold tracking-wide text-navy">
                  {report.projectNumber || "No project #"}
                </span>
                <span className="text-sm text-muted-foreground">
                  {formatShortDate(report.date)}
                  {report.printName ? ` · ${report.printName}` : ""}
                  {report.photoCount ? ` · ${report.photoCount} photos` : ""}
                </span>
              </button>
              <button
                type="button"
                onClick={() => {
                  if (window.confirm("Delete this report?")) onDelete(report.id);
                }}
                className="flex w-14 items-center justify-center text-muted-foreground hover:bg-muted hover:text-danger"
                aria-label="Delete report"
              >
                <Trash2 className="size-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
