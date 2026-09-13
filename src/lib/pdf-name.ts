import type { Report } from "@/lib/types";

export function suggestedPdfTitle(report: Pick<Report, "projectNumber" | "date" | "printName">) {
  const proj = (report.projectNumber || "").trim() || "00000";
  const ymd = (report.date || "").replace(/-/g, "").slice(2);
  const first = (report.printName || "").trim().split(/\s+/)[0] || "Name";
  return `${proj}- ${ymd} ${first}`;
}

export function reportFileName(report: Report) {
  const raw = (report.pdfTitle || suggestedPdfTitle(report)).trim();
  const safe = raw.replace(/[\\/:*?"<>|]/g, "-").replace(/\.pdf$/i, "");
  return `${safe || "report"}.pdf`;
}
