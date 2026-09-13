import { jsPDF } from "jspdf";
import { formatLongDate } from "@/lib/dates";
import type { Photo, Report } from "@/lib/types";

const NAVY: [number, number, number] = [12, 35, 64];
const INK: [number, number, number] = [20, 32, 51];
const MUTED: [number, number, number] = [92, 101, 112];
const LINE: [number, number, number] = [196, 188, 168];
const HEAD_BG: [number, number, number] = [232, 226, 212];
const PAPER: [number, number, number] = [255, 252, 245];

function yn(v: string) {
  if (v === "yes") return "YES";
  if (v === "no") return "NO";
  return "";
}

function filledRows<T extends { description?: string; className?: string }>(
  rows: T[],
  key: "description" | "className" = "description",
) {
  return rows.filter((r) => String(r[key] ?? "").trim().length > 0);
}

export async function buildReportPdf(report: Report, photos: Photo[]): Promise<Blob> {
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const pageW = 612;
  const margin = 36;
  const contentW = pageW - margin * 2;
  let y = 0;

  const ensure = (need: number) => {
    if (y + need > 756) {
      doc.addPage();
      y = 36;
    }
  };

  // Header bar
  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, 78, "F");
  doc.setFillColor(196, 154, 54);
  doc.rect(0, 78, pageW, 3, "F");

  // Triangle mark
  doc.setFillColor(255, 252, 245);
  doc.triangle(44, 18, 68, 62, 20, 62, "F");
  doc.setFillColor(...NAVY);
  doc.triangle(44, 30, 58, 56, 30, 56, "F");

  doc.setTextColor(255, 252, 245);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(22);
  doc.text("STX", 78, 38);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("CORPORATION  ·  RAILROAD CONSTRUCTION SERVICES", 78, 52);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text("DAILY PROJECT SUMMARY", pageW - margin, 36, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(formatLongDate(report.date) || report.date, pageW - margin, 52, { align: "right" });
  doc.text(`Project # ${report.projectNumber || "—"}`, pageW - margin, 64, { align: "right" });

  y = 98;
  doc.setTextColor(...INK);

  const sectionTitle = (title: string, width = contentW) => {
    ensure(24);
    doc.setFillColor(...NAVY);
    doc.rect(margin, y, width, 18, "F");
    doc.setTextColor(255, 252, 245);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(title.toUpperCase(), margin + 8, y + 12.5);
    doc.setTextColor(...INK);
    y += 18;
  };

  const boxText = (text: string, minH = 56) => {
    const lines = doc.splitTextToSize(text.trim() || " ", contentW - 16) as string[];
    const h = Math.max(minH, lines.length * 12 + 16);
    ensure(h);
    doc.setDrawColor(...LINE);
    doc.setFillColor(...PAPER);
    doc.rect(margin, y, contentW, h, "FD");
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(lines, margin + 8, y + 16);
    y += h;
  };

  sectionTitle("Summary of Work Performed");
  boxText(report.summary, 72);
  y += 8;
  sectionTitle("Delays / Interruptions");
  boxText(report.delays || "None", 40);
  y += 12;

  // Two-column tables
  const colGap = 10;
  const colW = (contentW - colGap) / 2;
  const leftX = margin;
  const rightX = margin + colW + colGap;
  const startY = y;

  const received = filledRows(report.received);
  const consumed = filledRows(report.consumed);
  const leftH = drawMaterialTable(
    doc,
    leftX,
    startY,
    colW,
    "Received and Accounted Materials",
    ["Description", "QTY", "BOL"],
    received.map((r) => [r.description, r.qty, yn(r.bolFiled)]),
    [colW - 78, 36, 42],
  );
  const rightH = drawMaterialTable(
    doc,
    rightX,
    startY,
    colW,
    "Materials Consumed",
    ["Description", "QTY"],
    consumed.map((r) => [r.description, r.qty]),
    [colW - 44, 44],
  );
  y = startY + Math.max(leftH, rightH) + 12;

  ensure(80);
  const crewY = y;
  const manpower = filledRows(report.manpower, "className");
  const subs = filledRows(report.subcontractors);
  const manH = drawMaterialTable(
    doc,
    leftX,
    crewY,
    colW,
    "Manpower and Equipment",
    ["Class", "QTY", "Hours"],
    manpower.map((r) => [r.className, r.qty, r.hours]),
    [colW - 88, 40, 48],
  );
  const subH = drawMaterialTable(
    doc,
    rightX,
    crewY,
    colW,
    "Subcontractors",
    ["Description", "Hours"],
    subs.flatMap((s) => {
      const rows: string[][] = [[s.description, s.hours]];
      if (s.details.trim()) rows.push([`Details: ${s.details}`, ""]);
      return rows;
    }),
    [colW - 52, 52],
  );
  y = crewY + Math.max(manH, subH) + 14;

  ensure(130);
  sectionTitle("Closeout");
  const closeRows: [string, string][] = [
    ["Any incidents today?", yn(report.incidents)],
    ["Any equipment issues today?", yn(report.equipmentIssues)],
    ["Site secure before leaving?", yn(report.siteSecure)],
    ["Derails down?", yn(report.derailsDown)],
    ["All locks removed?", yn(report.locksRemoved)],
  ];
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  for (const [label, value] of closeRows) {
    ensure(16);
    doc.setTextColor(...INK);
    doc.text(label, margin + 8, y + 11);
    doc.setFont("helvetica", "bold");
    doc.text(value || "—", margin + 250, y + 11);
    doc.setFont("helvetica", "normal");
    y += 16;
  }

  if (report.incidents === "yes" && report.incidentsExplain.trim()) {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Incident explanation", margin + 8, y + 10);
    y += 14;
    boxText(report.incidentsExplain, 36);
  }
  if (report.equipmentIssues === "yes" && report.equipmentIssuesExplain.trim()) {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Equipment issues (copy to reports@stxrailroad.com)", margin + 8, y + 10);
    y += 14;
    boxText(report.equipmentIssuesExplain, 36);
  }

  y += 18;
  ensure(90);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.6);
  doc.line(margin, y + 36, margin + 220, y + 36);
  doc.line(margin + 250, y + 36, margin + contentW, y + 36);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("PRINT NAME", margin, y + 48);
  doc.text("SIGNATURE", margin + 250, y + 48);
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(report.printName || " ", margin, y + 30);

  if (report.signatureDataUrl) {
    try {
      const sigW = 200;
      const sigH = 48;
      doc.addImage(report.signatureDataUrl, "PNG", margin + 250, y - 8, sigW, sigH, undefined, "FAST");
    } catch {
      /* skip bad signature */
    }
  }

  y += 64;
  doc.setFont("helvetica", "italic");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text(
    `Job photos attached: ${photos.length}    ·    Generated ${new Date().toLocaleString()}`,
    margin,
    y,
  );

  // Photo pages
  if (photos.length > 0) {
    doc.addPage();
    y = 36;
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 48, "F");
    doc.setTextColor(255, 252, 245);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Job Photos", margin, 30);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(`Project # ${report.projectNumber || "—"}  ·  ${formatLongDate(report.date)}`, pageW - margin, 30, {
      align: "right",
    });
    y = 64;

    const photoW = contentW;
    const photoH = 280;
    for (let i = 0; i < photos.length; i += 1) {
      const photo = photos[i];
      if (!photo) continue;
      ensure(photoH + 36);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...INK);
      const caption = photo.caption.trim() || `Photo ${i + 1}`;
      doc.text(`${i + 1}.  ${caption}`, margin, y + 12);
      y += 18;
      try {
        const dims = await imageSize(photo.dataUrl);
        const fit = fitContain(dims.w, dims.h, photoW, photoH);
        doc.setDrawColor(...LINE);
        doc.setFillColor(245, 242, 234);
        doc.rect(margin, y, photoW, fit.h, "S");
        doc.addImage(photo.dataUrl, "JPEG", margin + (photoW - fit.w) / 2, y, fit.w, fit.h, undefined, "FAST");
        y += fit.h + 16;
      } catch {
        doc.setFont("helvetica", "italic");
        doc.text("(photo could not be embedded)", margin, y + 14);
        y += 28;
      }
    }
  }

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text("STX Corporation — Daily Project Summary", margin, 776);
    doc.text(`Page ${i} of ${pages}`, pageW - margin, 776, { align: "right" });
  }

  return doc.output("blob");
}

function drawMaterialTable(
  doc: jsPDF,
  x: number,
  y: number,
  width: number,
  title: string,
  headers: string[],
  rows: string[][],
  colWidths: number[],
) {
  const rowH = 16;
  const headH = 18;
  const minBodyRows = 4;
  const bodyRows = Math.max(minBodyRows, rows.length);
  const h = headH + 16 + bodyRows * rowH;

  doc.setFillColor(...NAVY);
  doc.rect(x, y, width, 16, "F");
  doc.setTextColor(255, 252, 245);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text(title.toUpperCase(), x + 6, y + 11);

  let cy = y + 16;
  doc.setFillColor(...HEAD_BG);
  doc.rect(x, cy, width, headH, "F");
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  let cx = x;
  headers.forEach((hLabel, i) => {
    const w = colWidths[i] ?? 40;
    doc.text(hLabel, cx + 4, cy + 12);
    cx += w;
  });
  cy += headH;

  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.4);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  for (let r = 0; r < bodyRows; r += 1) {
    const row = rows[r];
    cx = x;
    headers.forEach((_, i) => {
      const w = colWidths[i] ?? 40;
      doc.rect(cx, cy, w, rowH);
      if (row) {
        const cell = String(row[i] ?? "");
        const clipped = doc.splitTextToSize(cell, w - 6) as string[];
        doc.text(clipped[0] ?? "", cx + 3, cy + 11);
      }
      cx += w;
    });
    cy += rowH;
  }

  return h;
}

function imageSize(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => reject(new Error("image"));
    img.src = dataUrl;
  });
}

function fitContain(w: number, h: number, maxW: number, maxH: number) {
  const scale = Math.min(maxW / w, maxH / h);
  return { w: w * scale, h: h * scale };
}

export function reportFileName(report: Report) {
  const proj = (report.projectNumber || "project").replace(/[^\w.-]+/g, "_");
  return `STX-DPS-${proj}-${report.date}.pdf`;
}
