import { formatLongDate } from "@/lib/dates";
import { dataUrlToFile } from "@/lib/photo-db";
import { reportFileName } from "@/lib/pdf";
import type { Photo, Report } from "@/lib/types";

export function formatReportText(report: Report): string {
  const line = (label: string, value: string) => `${label}: ${value || "—"}`;
  const yn = (v: string) => (v === "yes" ? "Yes" : v === "no" ? "No" : "—");
  const received = report.received
    .filter((r) => r.description.trim())
    .map((r) => `  • ${r.description}  qty ${r.qty || "—"}  BOL ${yn(r.bolFiled)}`)
    .join("\n");
  const consumed = report.consumed
    .filter((r) => r.description.trim())
    .map((r) => `  • ${r.description}  qty ${r.qty || "—"}`)
    .join("\n");
  const crew = report.manpower
    .filter((r) => r.className.trim())
    .map((r) => `  • ${r.className}  qty ${r.qty || "—"}  hrs ${r.hours || "—"}`)
    .join("\n");
  const subs = report.subcontractors
    .filter((r) => r.description.trim())
    .map((r) => `  • ${r.description}  hrs ${r.hours || "—"}${r.details ? `\n    ${r.details}` : ""}`)
    .join("\n");

  return [
    "STX CORPORATION — DAILY PROJECT SUMMARY",
    line("Date", formatLongDate(report.date) || report.date),
    line("Project #", report.projectNumber),
    line("Supervisor", report.printName),
    "",
    "SUMMARY OF WORK PERFORMED",
    report.summary.trim() || "—",
    "",
    "DELAYS / INTERRUPTIONS",
    report.delays.trim() || "None",
    "",
    "RECEIVED AND ACCOUNTED MATERIALS",
    received || "  (none)",
    "",
    "MATERIALS CONSUMED",
    consumed || "  (none)",
    "",
    "MANPOWER AND EQUIPMENT",
    crew || "  (none)",
    "",
    "SUBCONTRACTORS",
    subs || "  (none)",
    "",
    line("Any incidents today", yn(report.incidents)),
    report.incidents === "yes" ? report.incidentsExplain : "",
    line("Any equipment issues today", yn(report.equipmentIssues)),
    report.equipmentIssues === "yes" ? report.equipmentIssuesExplain : "",
    line("Site secure before leaving", yn(report.siteSecure)),
    line("Derails down", yn(report.derailsDown)),
    line("All locks removed", yn(report.locksRemoved)),
    "",
    `Job photos: ${report.photoCount}`,
    "",
    "Print name: " + (report.printName || "—"),
  ]
    .filter((x) => x !== "")
    .join("\n");
}

export function emailSubject(report: Report) {
  return `Daily Project Summary — ${report.projectNumber || "Project"} — ${report.date}`;
}

export function mailtoHref(report: Report) {
  const to = encodeURIComponent(report.recipientEmail || "");
  const subject = encodeURIComponent(emailSubject(report));
  const body = encodeURIComponent(
    formatReportText(report) +
      "\n\n---\nA PDF of this report and job photos should be attached if you used Share. If they are missing, attach the downloaded PDF and photos before sending.",
  );
  return `mailto:${to}?subject=${subject}&body=${body}`;
}

export function canShareFiles() {
  if (typeof navigator === "undefined" || typeof File === "undefined") return false;
  if (typeof navigator.share !== "function") return false;
  if (typeof navigator.canShare !== "function") return true;
  try {
    const probe = new File([new Blob(["t"], { type: "text/plain" })], "t.txt", { type: "text/plain" });
    return navigator.canShare({ files: [probe] });
  } catch {
    return false;
  }
}

export async function shareReport(report: Report, photos: Photo[], pdfBlob: Blob): Promise<"shared" | "cancelled"> {
  const pdfFile = new File([pdfBlob], reportFileName(report), { type: "application/pdf" });
  const photoFiles = photos.map((p, i) =>
    dataUrlToFile(p.dataUrl, `job-photo-${i + 1}.jpg`),
  );
  const files = [pdfFile, ...photoFiles];
  await navigator.share({
    title: emailSubject(report),
    text: `Daily Project Summary for project ${report.projectNumber || "—"} on ${report.date}. Please send to ${report.recipientEmail}.`,
    files,
  });
  return "shared";
}

export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}
