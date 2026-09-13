export type YesNo = "yes" | "no" | "";

export type ReportStatus = "draft" | "sent";

export interface MaterialReceived {
  id: string;
  description: string;
  qty: string;
  bolFiled: YesNo;
}

export interface MaterialConsumed {
  id: string;
  description: string;
  qty: string;
}

export interface ManpowerRow {
  id: string;
  className: string;
  qty: string;
  hours: string;
}

export interface SubcontractorRow {
  id: string;
  description: string;
  hours: string;
  details: string;
}

export interface Photo {
  id: string;
  dataUrl: string;
  caption: string;
  takenAt: string;
}

export interface Report {
  id: string;
  status: ReportStatus;
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  date: string;
  projectNumber: string;
  printName: string;
  summary: string;
  delays: string;
  received: MaterialReceived[];
  consumed: MaterialConsumed[];
  manpower: ManpowerRow[];
  subcontractors: SubcontractorRow[];
  incidents: YesNo;
  incidentsExplain: string;
  equipmentIssues: YesNo;
  equipmentIssuesExplain: string;
  siteSecure: YesNo;
  derailsDown: YesNo;
  locksRemoved: YesNo;
  photoCount: number;
  signatureDataUrl: string;
  recipientEmail: string;
}

export interface Settings {
  defaultName: string;
  defaultEmail: string;
  lastProject: string;
  recentProjects: string[];
  recentClasses: string[];
}

export const DEFAULT_EMAIL = "reports@stxrailroad.com";

export const MANPOWER_PRESETS = [
  "Foreman",
  "Laborer",
  "Operator",
  "Hi-Rail Operator",
  "Truck Driver",
  "Welder",
  "Flagman",
  "Excavator",
  "Tamper",
  "Regulator",
  "Spike Driver",
  "Loader",
  "Pickup",
] as const;

export const WIZARD_STEPS = [
  { id: "job", label: "Job" },
  { id: "work", label: "Work" },
  { id: "materials", label: "Materials" },
  { id: "crew", label: "Crew" },
  { id: "closeout", label: "Closeout" },
  { id: "photos", label: "Photos" },
  { id: "send", label: "Send" },
] as const;

export type StepId = (typeof WIZARD_STEPS)[number]["id"];
