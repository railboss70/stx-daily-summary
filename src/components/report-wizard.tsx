import { useNavigate } from "@tanstack/react-router";
import {
  ChevronLeft,
  ChevronRight,
  Download,
  Loader2,
  Mail,
  Share2,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { AppShell, ShellHeader } from "@/components/app-shell";
import { Field, SectionCard } from "@/components/field";
import { PhotoCapture } from "@/components/photo-capture";
import { RowList } from "@/components/row-list";
import { SignaturePad } from "@/components/signature-pad";
import { StxLogo } from "@/components/stx-logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { YesNo } from "@/components/yes-no";
import { formatLongDate } from "@/lib/dates";
import { loadPhotos, savePhotos } from "@/lib/photo-db";
import { buildReportPdf, reportFileName } from "@/lib/pdf";
import {
  canShareFiles,
  downloadBlob,
  emailSubject,
  mailtoHref,
  shareReport,
} from "@/lib/share";
import { rowFactories, useReport, useReportStore } from "@/lib/store";
import {
  MANPOWER_PRESETS,
  WIZARD_STEPS,
  type Photo,
  type Report,
  type StepId,
} from "@/lib/types";
import { cn } from "@/lib/utils";

const MIN_PHOTOS = 3;

function stepErrors(step: StepId, report: Report, photos: Photo[]): string[] {
  const errors: string[] = [];
  if (step === "job") {
    if (!report.date) errors.push("Date is required.");
    if (!report.projectNumber.trim()) errors.push("Project number is required.");
    if (!report.printName.trim()) errors.push("Print your name.");
  }
  if (step === "work") {
    if (!report.summary.trim()) errors.push("Enter a summary of work performed.");
  }
  if (step === "closeout") {
    if (!report.incidents) errors.push("Incidents: Yes or No.");
    if (report.incidents === "yes" && !report.incidentsExplain.trim()) {
      errors.push("Explain today's incident.");
    }
    if (!report.equipmentIssues) errors.push("Equipment issues: Yes or No.");
    if (report.equipmentIssues === "yes" && !report.equipmentIssuesExplain.trim()) {
      errors.push("Describe the equipment issue.");
    }
    if (!report.siteSecure) errors.push("Site secure: Yes or No.");
    if (!report.derailsDown) errors.push("Derails down: Yes or No.");
    if (!report.locksRemoved) errors.push("All locks removed: Yes or No.");
  }
  if (step === "photos" || step === "send") {
    if (photos.length < MIN_PHOTOS) errors.push("Attach at least 3 job photos.");
    if (!report.signatureDataUrl) errors.push("Signature is required.");
  }
  if (step === "send") {
    if (!report.recipientEmail.trim() || !report.recipientEmail.includes("@")) {
      errors.push("Enter a valid email address.");
    }
  }
  return errors;
}

export function ReportWizard({ reportId }: { reportId: string }) {
  const navigate = useNavigate();
  const report = useReport(reportId);
  const updateReport = useReportStore((s) => s.updateReport);
  const markSent = useReportStore((s) => s.markSent);
  const settings = useReportStore((s) => s.settings);
  const [stepIndex, setStepIndex] = useState(0);
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photosReady, setPhotosReady] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void loadPhotos(reportId).then((loaded) => {
      if (cancelled) return;
      setPhotos(loaded);
      setPhotosReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, [reportId]);

  const persistPhotos = (next: Photo[]) => {
    setPhotos(next);
    updateReport(reportId, { photoCount: next.length });
    void savePhotos(reportId, next);
  };

  if (!report) {
    return (
      <AppShell>
        <ShellHeader>
          <StxLogo inverted variant="compact" />
        </ShellHeader>
        <main className="flex flex-1 flex-col items-center justify-center gap-4 p-6 text-center">
          <p className="text-lg">That report was not found.</p>
          <Button onClick={() => navigate({ to: "/" })}>Back to home</Button>
        </main>
      </AppShell>
    );
  }

  const step = WIZARD_STEPS[stepIndex] ?? WIZARD_STEPS[0];
  const isLast = stepIndex === WIZARD_STEPS.length - 1;
  const progress = ((stepIndex + 1) / WIZARD_STEPS.length) * 100;

  const patch = (partial: Partial<Report>) => updateReport(reportId, partial);

  const goNext = () => {
    const nextErrors = stepErrors(step.id, report, photos);
    if (nextErrors.length) {
      setErrors(nextErrors);
      toast.error(nextErrors[0]);
      return;
    }
    setErrors([]);
    if (!isLast) setStepIndex((i) => i + 1);
  };

  const goBack = () => {
    setErrors([]);
    if (stepIndex === 0) {
      navigate({ to: "/" });
      return;
    }
    setStepIndex((i) => i - 1);
  };

  const handleSendShare = async () => {
    const nextErrors = stepErrors("send", report, photos);
    if (nextErrors.length) {
      setErrors(nextErrors);
      toast.error(nextErrors[0]);
      return;
    }
    setSending(true);
    try {
      const pdf = await buildReportPdf(report, photos);
      if (canShareFiles()) {
        try {
          await shareReport(report, photos, pdf);
          markSent(reportId);
          toast.success("Opened share sheet. Send to Mail with the PDF and photos.");
          return;
        } catch (err) {
          if ((err as { name?: string }).name === "AbortError") return;
        }
      }
      downloadBlob(pdf, reportFileName(report));
      window.location.href = mailtoHref(report);
      markSent(reportId);
      toast.success("PDF downloaded and Mail opened. Attach the PDF and photos before sending.");
    } catch {
      toast.error("Could not build the report. Try again.");
    } finally {
      setSending(false);
    }
  };

  const handleDownload = async () => {
    setSending(true);
    try {
      const pdf = await buildReportPdf(report, photos);
      downloadBlob(pdf, reportFileName(report));
      toast.success("PDF saved.");
    } catch {
      toast.error("Could not build the PDF.");
    } finally {
      setSending(false);
    }
  };

  const handleMailto = () => {
    const nextErrors = stepErrors("send", report, photos);
    if (nextErrors.length) {
      setErrors(nextErrors);
      toast.error(nextErrors[0]);
      return;
    }
    window.location.href = mailtoHref(report);
    markSent(reportId);
  };

  return (
    <AppShell
      footer={
        <div className="border-t border-border bg-paper-bright/95 pb-safe backdrop-blur-sm">
          <div className="grid grid-cols-2 gap-3 px-4 py-3">
            <Button type="button" variant="outline" onClick={goBack}>
              <ChevronLeft />
              {stepIndex === 0 ? "Home" : "Back"}
            </Button>
            {isLast ? (
              <Button type="button" onClick={() => void handleSendShare()} disabled={sending}>
                {sending ? <Loader2 className="animate-spin" /> : <Share2 />}
                Send
              </Button>
            ) : (
              <Button type="button" onClick={goNext}>
                Next
                <ChevronRight />
              </Button>
            )}
          </div>
        </div>
      }
    >
      <ShellHeader>
        <div className="flex items-center justify-between gap-3">
          <StxLogo inverted variant="compact" />
          <div className="text-right">
            <p className="font-display text-sm font-semibold tracking-[0.16em] text-paper-bright/70 uppercase">
              Step {stepIndex + 1} of {WIZARD_STEPS.length}
            </p>
            <p className="font-display text-lg font-semibold tracking-wide">{step.label}</p>
          </div>
        </div>
        <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-paper-bright/15">
          <div className="h-full bg-brass transition-[width] duration-200" style={{ width: `${progress}%` }} />
        </div>
      </ShellHeader>

      <main className="flex flex-1 flex-col gap-4 px-4 py-5 pb-28">
        {step.id === "job" ? <JobStep report={report} patch={patch} settingsProjects={settings.recentProjects} /> : null}
        {step.id === "work" ? <WorkStep report={report} patch={patch} /> : null}
        {step.id === "materials" ? <MaterialsStep report={report} patch={patch} /> : null}
        {step.id === "crew" ? <CrewStep report={report} patch={patch} /> : null}
        {step.id === "closeout" ? <CloseoutStep report={report} patch={patch} /> : null}
        {step.id === "photos" ? (
          <PhotosStep
            report={report}
            patch={patch}
            photos={photos}
            onPhotos={persistPhotos}
            ready={photosReady}
          />
        ) : null}
        {step.id === "send" ? (
          <SendStep
            report={report}
            patch={patch}
            photos={photos}
            sending={sending}
            onShare={() => void handleSendShare()}
            onDownload={() => void handleDownload()}
            onMailto={handleMailto}
          />
        ) : null}

        {errors.length > 0 ? (
          <ul className="rounded-lg border border-danger/30 bg-danger/10 px-4 py-3 text-sm text-danger">
            {errors.map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        ) : null}
      </main>
    </AppShell>
  );
}

function JobStep({
  report,
  patch,
  settingsProjects,
}: {
  report: Report;
  patch: (p: Partial<Report>) => void;
  settingsProjects: string[];
}) {
  return (
    <>
      <SectionCard title="Job information">
        <Field label="Date">
          <Input
            type="date"
            value={report.date}
            onChange={(e) => patch({ date: e.target.value })}
          />
        </Field>
        <Field label="Project #">
          <Input
            value={report.projectNumber}
            onChange={(e) => patch({ projectNumber: e.target.value })}
            placeholder="Project number"
            autoCapitalize="characters"
          />
        </Field>
        {settingsProjects.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {settingsProjects.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => patch({ projectNumber: p })}
                className={cn(
                  "h-10 rounded-md border px-3 text-sm",
                  report.projectNumber === p
                    ? "border-navy bg-navy text-paper-bright"
                    : "border-border bg-card text-foreground",
                )}
              >
                {p}
              </button>
            ))}
          </div>
        ) : null}
        <Field label="Print name" hint="Supervisor completing this report">
          <Input
            value={report.printName}
            onChange={(e) => patch({ printName: e.target.value })}
            placeholder="Your name"
            autoComplete="name"
            autoCapitalize="words"
          />
        </Field>
      </SectionCard>
    </>
  );
}

function WorkStep({
  report,
  patch,
}: {
  report: Report;
  patch: (p: Partial<Report>) => void;
}) {
  return (
    <>
      <SectionCard title="Summary of work performed">
        <Field label="What was done today">
          <Textarea
            value={report.summary}
            onChange={(e) => patch({ summary: e.target.value })}
            placeholder="Track work, surfacing, tie replacement, welding…"
            rows={8}
          />
        </Field>
      </SectionCard>
      <SectionCard title="Delays / interruptions">
        <Field label="Delays" hint="Leave blank if none">
          <Textarea
            value={report.delays}
            onChange={(e) => patch({ delays: e.target.value })}
            placeholder="Train traffic, weather, waiting on materials…"
            rows={4}
            className="min-h-24"
          />
        </Field>
      </SectionCard>
    </>
  );
}

function MaterialsStep({
  report,
  patch,
}: {
  report: Report;
  patch: (p: Partial<Report>) => void;
}) {
  return (
    <>
      <SectionCard title="Received and accounted materials">
        <RowList
          rows={report.received}
          addLabel="Add received material"
          onAdd={() => patch({ received: [...report.received, rowFactories.received()] })}
          onRemove={(id) =>
            patch({
              received:
                report.received.length <= 1
                  ? report.received.map((r) => (r.id === id ? rowFactories.received() : r))
                  : report.received.filter((r) => r.id !== id),
            })
          }
          render={(row) => (
            <div className="flex flex-col gap-3">
              <Field label="Description">
                <Input
                  value={row.description}
                  onChange={(e) =>
                    patch({
                      received: report.received.map((r) =>
                        r.id === row.id ? { ...r, description: e.target.value } : r,
                      ),
                    })
                  }
                  placeholder="Ties, rail, ballast…"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="QTY">
                  <Input
                    inputMode="decimal"
                    value={row.qty}
                    onChange={(e) =>
                      patch({
                        received: report.received.map((r) =>
                          r.id === row.id ? { ...r, qty: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </Field>
                <YesNo
                  label="BOL filed"
                  value={row.bolFiled}
                  onChange={(bolFiled) =>
                    patch({
                      received: report.received.map((r) =>
                        r.id === row.id ? { ...r, bolFiled } : r,
                      ),
                    })
                  }
                />
              </div>
            </div>
          )}
        />
      </SectionCard>
      <SectionCard title="Materials consumed">
        <RowList
          rows={report.consumed}
          addLabel="Add consumed material"
          onAdd={() => patch({ consumed: [...report.consumed, rowFactories.consumed()] })}
          onRemove={(id) =>
            patch({
              consumed:
                report.consumed.length <= 1
                  ? report.consumed.map((r) => (r.id === id ? rowFactories.consumed() : r))
                  : report.consumed.filter((r) => r.id !== id),
            })
          }
          render={(row) => (
            <div className="grid grid-cols-4 gap-3">
              <Field label="Description" className="col-span-3">
                <Input
                  value={row.description}
                  onChange={(e) =>
                    patch({
                      consumed: report.consumed.map((r) =>
                        r.id === row.id ? { ...r, description: e.target.value } : r,
                      ),
                    })
                  }
                  placeholder="Spikes, plates, ballast…"
                />
              </Field>
              <Field label="QTY">
                <Input
                  inputMode="decimal"
                  value={row.qty}
                  onChange={(e) =>
                    patch({
                      consumed: report.consumed.map((r) =>
                        r.id === row.id ? { ...r, qty: e.target.value } : r,
                      ),
                    })
                  }
                />
              </Field>
            </div>
          )}
        />
      </SectionCard>
    </>
  );
}

function CrewStep({
  report,
  patch,
}: {
  report: Report;
  patch: (p: Partial<Report>) => void;
}) {
  const recentClasses = useReportStore((s) => s.settings.recentClasses) ?? [];
  const writeInRef = useRef<HTMLInputElement | null>(null);
  const [focusWriteIn, setFocusWriteIn] = useState(false);

  const addPreset = (className: string) => {
    const blank = report.manpower.find((r) => !r.className.trim());
    if (blank) {
      patch({
        manpower: report.manpower.map((r) =>
          r.id === blank.id ? { ...r, className } : r,
        ),
      });
      return;
    }
    patch({
      manpower: [...report.manpower, { ...rowFactories.manpower(), className }],
    });
  };

  const addWriteIn = () => {
    const blank = report.manpower.find((r) => !r.className.trim());
    if (!blank) {
      patch({ manpower: [...report.manpower, rowFactories.manpower()] });
    }
    setFocusWriteIn(true);
  };

  useEffect(() => {
    if (!focusWriteIn) return;
    writeInRef.current?.focus();
    setFocusWriteIn(false);
  }, [focusWriteIn, report.manpower]);

  const writeInId = report.manpower.find((r) => !r.className.trim())?.id;

  return (
    <>
      <SectionCard title="Manpower and equipment">
        <p className="text-sm text-muted-foreground">
          Tap a common class, or Other to write in any equipment or extra machines.
        </p>
        <div className="flex flex-wrap gap-2">
          {MANPOWER_PRESETS.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => addPreset(name)}
              className="h-10 rounded-md border border-border bg-card px-3 text-sm text-foreground hover:bg-muted"
            >
              {name}
            </button>
          ))}
          {recentClasses.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => addPreset(name)}
              className="h-10 rounded-md border border-navy/30 bg-accent px-3 text-sm text-navy hover:bg-muted"
            >
              {name}
            </button>
          ))}
          <button
            type="button"
            onClick={addWriteIn}
            className="h-10 rounded-md border border-dashed border-navy bg-card px-3 text-sm font-semibold text-navy hover:bg-muted"
          >
            Other
          </button>
        </div>
        <RowList
          rows={report.manpower}
          addLabel="Add another class / equipment"
          onAdd={addWriteIn}
          onRemove={(id) =>
            patch({
              manpower:
                report.manpower.length <= 1
                  ? report.manpower.map((r) => (r.id === id ? rowFactories.manpower() : r))
                  : report.manpower.filter((r) => r.id !== id),
            })
          }
          render={(row) => (
            <div className="flex flex-col gap-3">
              <Field label="Class / equipment">
                <Input
                  ref={row.id === writeInId ? writeInRef : undefined}
                  value={row.className}
                  onChange={(e) =>
                    patch({
                      manpower: report.manpower.map((r) =>
                        r.id === row.id ? { ...r, className: e.target.value } : r,
                      ),
                    })
                  }
                  placeholder="Write in any class or equipment"
                  autoCapitalize="words"
                />
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="QTY">
                  <Input
                    inputMode="decimal"
                    value={row.qty}
                    onChange={(e) =>
                      patch({
                        manpower: report.manpower.map((r) =>
                          r.id === row.id ? { ...r, qty: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </Field>
                <Field label="Hours">
                  <Input
                    inputMode="decimal"
                    value={row.hours}
                    onChange={(e) =>
                      patch({
                        manpower: report.manpower.map((r) =>
                          r.id === row.id ? { ...r, hours: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </Field>
              </div>
            </div>
          )}
        />
      </SectionCard>
      <SectionCard title="Subcontractors">
        <RowList
          rows={report.subcontractors}
          addLabel="Add subcontractor"
          onAdd={() =>
            patch({ subcontractors: [...report.subcontractors, rowFactories.subcontractors()] })
          }
          onRemove={(id) =>
            patch({
              subcontractors:
                report.subcontractors.length <= 1
                  ? report.subcontractors.map((r) =>
                      r.id === id ? rowFactories.subcontractors() : r,
                    )
                  : report.subcontractors.filter((r) => r.id !== id),
            })
          }
          render={(row) => (
            <div className="flex flex-col gap-3">
              <div className="grid grid-cols-4 gap-3">
                <Field label="Description" className="col-span-3">
                  <Input
                    value={row.description}
                    onChange={(e) =>
                      patch({
                        subcontractors: report.subcontractors.map((r) =>
                          r.id === row.id ? { ...r, description: e.target.value } : r,
                        ),
                      })
                    }
                    placeholder="Company or crew"
                  />
                </Field>
                <Field label="Hours">
                  <Input
                    inputMode="decimal"
                    value={row.hours}
                    onChange={(e) =>
                      patch({
                        subcontractors: report.subcontractors.map((r) =>
                          r.id === row.id ? { ...r, hours: e.target.value } : r,
                        ),
                      })
                    }
                  />
                </Field>
              </div>
              <Field label="Details">
                <Input
                  value={row.details}
                  onChange={(e) =>
                    patch({
                      subcontractors: report.subcontractors.map((r) =>
                        r.id === row.id ? { ...r, details: e.target.value } : r,
                      ),
                    })
                  }
                  placeholder="Work performed"
                />
              </Field>
            </div>
          )}
        />
      </SectionCard>
    </>
  );
}

function CloseoutStep({
  report,
  patch,
}: {
  report: Report;
  patch: (p: Partial<Report>) => void;
}) {
  return (
    <>
      <SectionCard title="Any incidents today?">
        <YesNo
          label="Incidents"
          value={report.incidents}
          onChange={(incidents) => patch({ incidents })}
        />
        {report.incidents === "yes" ? (
          <Field label="Explain" hint="Also keep a separate sheet if needed">
            <Textarea
              value={report.incidentsExplain}
              onChange={(e) => patch({ incidentsExplain: e.target.value })}
              placeholder="What happened, who was involved, actions taken"
            />
          </Field>
        ) : null}
      </SectionCard>
      <SectionCard title="Any equipment issues today?">
        <YesNo
          label="Equipment issues"
          value={report.equipmentIssues}
          onChange={(equipmentIssues) => patch({ equipmentIssues })}
        />
        {report.equipmentIssues === "yes" ? (
          <Field
            label="Describe the issue"
            hint="This goes out with the report to reports@stxrailroad.com"
          >
            <Textarea
              value={report.equipmentIssuesExplain}
              onChange={(e) => patch({ equipmentIssuesExplain: e.target.value })}
              placeholder="Machine, problem, impact to the work"
            />
          </Field>
        ) : null}
      </SectionCard>
      <SectionCard title="Site closeout">
        <YesNo
          label="Site secure before leaving?"
          value={report.siteSecure}
          onChange={(siteSecure) => patch({ siteSecure })}
        />
        <YesNo
          label="Derails down?"
          value={report.derailsDown}
          onChange={(derailsDown) => patch({ derailsDown })}
        />
        <YesNo
          label="All locks removed?"
          value={report.locksRemoved}
          onChange={(locksRemoved) => patch({ locksRemoved })}
        />
      </SectionCard>
    </>
  );
}

function PhotosStep({
  report,
  patch,
  photos,
  onPhotos,
  ready,
}: {
  report: Report;
  patch: (p: Partial<Report>) => void;
  photos: Photo[];
  onPhotos: (photos: Photo[]) => void;
  ready: boolean;
}) {
  return (
    <>
      <SectionCard title="Job photos">
        {ready ? (
          <PhotoCapture photos={photos} onChange={onPhotos} />
        ) : (
          <p className="text-sm text-muted-foreground">Loading photos…</p>
        )}
      </SectionCard>
      <SectionCard title="Signature">
        <Field label="Sign below">
          <SignaturePad
            value={report.signatureDataUrl}
            onChange={(signatureDataUrl) => patch({ signatureDataUrl })}
          />
        </Field>
      </SectionCard>
    </>
  );
}

function SendStep({
  report,
  patch,
  photos,
  sending,
  onShare,
  onDownload,
  onMailto,
}: {
  report: Report;
  patch: (p: Partial<Report>) => void;
  photos: Photo[];
  sending: boolean;
  onShare: () => void;
  onDownload: () => void;
  onMailto: () => void;
}) {
  const shareOk = useMemo(() => canShareFiles(), []);
  const receivedCount = report.received.filter((r) => r.description.trim()).length;
  const consumedCount = report.consumed.filter((r) => r.description.trim()).length;
  const crewCount = report.manpower.filter((r) => r.className.trim()).length;

  return (
    <>
      <SectionCard title="Review">
        <dl className="grid grid-cols-1 gap-3 text-base">
          <ReviewRow label="Date" value={formatLongDate(report.date)} />
          <ReviewRow label="Project #" value={report.projectNumber} />
          <ReviewRow label="Supervisor" value={report.printName} />
          <ReviewRow label="Work" value={report.summary} />
          <ReviewRow label="Delays" value={report.delays || "None"} />
          <ReviewRow label="Materials in" value={`${receivedCount} line${receivedCount === 1 ? "" : "s"}`} />
          <ReviewRow label="Materials used" value={`${consumedCount} line${consumedCount === 1 ? "" : "s"}`} />
          <ReviewRow label="Crew / equipment" value={`${crewCount} class${crewCount === 1 ? "" : "es"}`} />
          <ReviewRow label="Incidents" value={report.incidents === "yes" ? "Yes" : "No"} />
          <ReviewRow label="Equipment issues" value={report.equipmentIssues === "yes" ? "Yes" : "No"} />
          <ReviewRow
            label="Closeout"
            value={`Secure ${report.siteSecure === "yes" ? "Y" : "N"} · Derails ${report.derailsDown === "yes" ? "Y" : "N"} · Locks off ${report.locksRemoved === "yes" ? "Y" : "N"}`}
          />
          <ReviewRow label="Photos" value={`${photos.length}`} />
        </dl>
        {report.signatureDataUrl ? (
          <div>
            <p className="mb-1 font-display text-sm font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Signature
            </p>
            <img
              src={report.signatureDataUrl}
              alt="Signature"
              className="h-20 w-full rounded-md bg-card object-contain outline outline-1 -outline-offset-1 outline-navy/10"
            />
          </div>
        ) : null}
        {photos.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {photos.map((p, i) => (
              <img
                key={p.id}
                src={p.dataUrl}
                alt={p.caption || `Photo ${i + 1}`}
                className="h-24 w-full rounded-md object-cover outline outline-1 -outline-offset-1 outline-navy/10"
              />
            ))}
          </div>
        ) : null}
      </SectionCard>
      <SectionCard title="Send report">
        <Field label="Email to" hint="Default is reports@stxrailroad.com">
          <Input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={report.recipientEmail}
            onChange={(e) => patch({ recipientEmail: e.target.value })}
          />
        </Field>
        <p className="text-sm text-muted-foreground">
          Subject: {emailSubject(report)}. On your phone, Share opens Mail with the PDF and photos attached.
        </p>
        <Button type="button" size="lg" onClick={onShare} disabled={sending}>
          {sending ? <Loader2 className="animate-spin" /> : <Share2 />}
          {shareOk ? "Share PDF & photos" : "Download PDF & open Mail"}
        </Button>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={onMailto} disabled={sending}>
            <Mail />
            Open Mail
          </Button>
          <Button type="button" variant="outline" onClick={onDownload} disabled={sending}>
            <Download />
            PDF only
          </Button>
        </div>
      </SectionCard>
    </>
  );
}

function ReviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-b border-border/70 pb-2">
      <dt className="font-display text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-0.5 whitespace-pre-wrap text-foreground">{value || "—"}</dd>
    </div>
  );
}
