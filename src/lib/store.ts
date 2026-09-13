import { useEffect, useState } from "react";
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { todayISO } from "@/lib/dates";
import { suggestedPdfTitle } from "@/lib/pdf-name";
import { deletePhotos } from "@/lib/photo-db";
import {
  DEFAULT_EMAIL,
  MANPOWER_PRESETS,
  type MaterialConsumed,
  type MaterialReceived,
  type ManpowerRow,
  type Report,
  type Settings,
  type SubcontractorRow,
} from "@/lib/types";
import { uid } from "@/lib/utils";

function emptyReceived(): MaterialReceived {
  return { id: uid(), description: "", qty: "", bolFiled: "" };
}
function emptyConsumed(): MaterialConsumed {
  return { id: uid(), description: "", qty: "" };
}
function emptyManpower(): ManpowerRow {
  return { id: uid(), className: "", qty: "", hours: "" };
}
function emptySub(): SubcontractorRow {
  return { id: uid(), description: "", hours: "", details: "" };
}

export function createBlankReport(settings: Settings): Report {
  const now = new Date().toISOString();
  return {
    id: uid(),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    date: todayISO(),
    projectNumber: settings.lastProject,
    printName: settings.defaultName,
    summary: "",
    delays: "",
    received: [emptyReceived()],
    consumed: [emptyConsumed()],
    manpower: [emptyManpower()],
    subcontractors: [emptySub()],
    incidents: "",
    incidentsExplain: "",
    equipmentIssues: "",
    equipmentIssuesExplain: "",
    siteSecure: "",
    derailsDown: "",
    locksRemoved: "",
    photoCount: 0,
    signatureDataUrl: "",
    recipientEmail: settings.defaultEmail || DEFAULT_EMAIL,
    pdfTitle: "",
    pdfTitleCustom: false,
  };
}

interface ReportState {
  reports: Record<string, Report>;
  order: string[];
  settings: Settings;
  createReport: (fromLast?: boolean) => string;
  updateReport: (id: string, patch: Partial<Report>) => void;
  deleteReport: (id: string) => void;
  markSent: (id: string) => void;
  setSettings: (patch: Partial<Settings>) => void;
  migrateLegacy: () => void;
}

const defaultSettings: Settings = {
  defaultName: "",
  defaultEmail: DEFAULT_EMAIL,
  lastProject: "",
  recentProjects: [],
  recentClasses: [],
};

export const useReportStore = create<ReportState>()(
  persist(
    (set, get) => ({
      reports: {},
      order: [],
      settings: defaultSettings,

      createReport: (fromLast = false) => {
        const { settings, reports, order } = get();
        const report = createBlankReport(settings);
        if (fromLast) {
          const lastId = order.find((id) => reports[id]);
          const last = lastId ? reports[lastId] : undefined;
          if (last) {
            report.projectNumber = last.projectNumber;
            report.printName = last.printName || settings.defaultName;
            report.recipientEmail = last.recipientEmail || settings.defaultEmail;
            report.manpower =
              last.manpower.length > 0
                ? last.manpower.map((row) => ({
                    ...emptyManpower(),
                    className: row.className,
                    qty: row.qty,
                  }))
                : [emptyManpower()];
          }
        }
        set({
          reports: { ...reports, [report.id]: report },
          order: [report.id, ...order],
        });
        return report.id;
      },

      updateReport: (id, patch) => {
        const current = get().reports[id];
        if (!current) return;
        const next: Report = { ...current, ...patch, updatedAt: new Date().toISOString() };
        if (!next.pdfTitleCustom && ("date" in patch || "projectNumber" in patch || "printName" in patch || !next.pdfTitle)) {
          next.pdfTitle = suggestedPdfTitle(next);
        }
        set({
          reports: {
            ...get().reports,
            [id]: next,
          },
        });
      },

      deleteReport: (id) => {
        const { reports, order } = get();
        const next = { ...reports };
        delete next[id];
        set({ reports: next, order: order.filter((x) => x !== id) });
        void deletePhotos(id);
      },

      markSent: (id) => {
        const current = get().reports[id];
        if (!current) return;
        const project = current.projectNumber.trim();
        const name = current.printName.trim();
        const email = current.recipientEmail.trim() || DEFAULT_EMAIL;
        const recent = project
          ? [project, ...get().settings.recentProjects.filter((p) => p !== project)].slice(0, 8)
          : get().settings.recentProjects;
        const customClasses = current.manpower
          .map((row) => row.className.trim())
          .filter((name) => name && !(MANPOWER_PRESETS as readonly string[]).includes(name));
        const recentClasses = [
          ...customClasses,
          ...(get().settings.recentClasses ?? []).filter((c) => !customClasses.includes(c)),
        ].slice(0, 12);
        set({
          reports: {
            ...get().reports,
            [id]: {
              ...current,
              status: "sent",
              sentAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
              recipientEmail: email,
            },
          },
          settings: {
            ...get().settings,
            defaultName: name || get().settings.defaultName,
            defaultEmail: email,
            lastProject: project || get().settings.lastProject,
            recentProjects: recent,
            recentClasses,
          },
        });
      },

      setSettings: (patch) => {
        set({ settings: { ...get().settings, ...patch } });
      },

      migrateLegacy: () => {
        const { settings, reports } = get();
        let reportsChanged = false;
        const nextReports: Record<string, Report> = { ...reports };
        for (const [id, report] of Object.entries(nextReports)) {
          let changed = report;
          if (report.recipientEmail.includes("stxrrailroad")) {
            changed = { ...changed, recipientEmail: DEFAULT_EMAIL };
          }
          if (changed.pdfTitle == null || changed.pdfTitleCustom == null) {
            changed = {
              ...changed,
              pdfTitle: changed.pdfTitle || suggestedPdfTitle(changed),
              pdfTitleCustom: Boolean(changed.pdfTitleCustom),
            };
          }
          if (changed !== report) {
            nextReports[id] = changed;
            reportsChanged = true;
          }
        }
        const email = settings.defaultEmail.includes("stxrrailroad")
          ? DEFAULT_EMAIL
          : settings.defaultEmail || DEFAULT_EMAIL;
        set({
          reports: reportsChanged ? nextReports : reports,
          settings: {
            ...settings,
            defaultEmail: email,
            recentClasses: settings.recentClasses ?? [],
          },
        });
      },
    }),
    {
      name: "stx-dps-v1",
      partialize: (state) => ({
        reports: state.reports,
        order: state.order,
        settings: state.settings,
      }),
    },
  ),
);

export function useHasHydrated() {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const persistApi = useReportStore.persist;
    const done = () => {
      useReportStore.getState().migrateLegacy();
      setHydrated(true);
    };
    if (persistApi.hasHydrated()) {
      done();
      return;
    }
    return persistApi.onFinishHydration(done);
  }, []);
  return hydrated;
}

export function useReport(id: string) {
  return useReportStore((s) => s.reports[id]);
}

export const rowFactories = {
  received: emptyReceived,
  consumed: emptyConsumed,
  manpower: emptyManpower,
  subcontractors: emptySub,
};
