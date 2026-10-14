const DEFAULT_EMAIL = "reports@stxrailroad.com";
const CREW_PRESETS = ["Foreman", "Laborer", "Operator", "Hi-Rail Operator", "Truck Driver", "Welder", "Flagman"];
const EQUIP_PRESETS = ["Excavator", "Tamper", "Regulator", "Spike Driver", "Loader", "Pickup"];
const PRESETS = CREW_PRESETS.concat(EQUIP_PRESETS);
const WEATHER = ["Clear", "Partly Cloudy", "Cloudy", "Rain", "Storms", "Wind", "Fog", "Hot", "Cold", "Snow/Ice"];
const STEPS = ["Job", "Work", "Materials", "Crew", "Closeout", "Photos", "Send"];
const KEY = "stx-dps-pages-v1";
const DB_NAME = "stx-dps";
const PHOTO_STORE = "photos";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayISO = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return d.getFullYear() + "-" + z(d.getMonth() + 1) + "-" + z(d.getDate());
};
const formatLong = (iso) => {
  if (!iso) return "";
  const parts = String(iso).split("-").map(Number);
  if (parts.length < 3 || parts.some((n) => !n && n !== 0)) return "";
  return new Date(parts[0], parts[1] - 1, parts[2]).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
};
const formatTaken = (iso) => {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", {
    month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
  });
};
const CLOSEOUT = [
  ["jobBriefing", "Job briefing held", "Job briefing held"],
  ["siteSecure", "Site secure before leaving", "Site secure"],
  ["derailsDown", "Derails down", "Derails down"],
  ["locksRemoved", "All locks removed", "Locks removed"],
  ["chocks", "Equipment parked with wheel chocks", "Equip. parked w/ chocks"],
  ["jobsiteClean", "Jobsite clean", "Jobsite clean"],
  ["materialsSecured", "Materials stored clear of track", "Materials clear of track"],
];
const PDF_DENSITY = [
  { font: 9, lh: 11, bar: 14, head: 13, row: 14, gap: 4, sum: 15, tot: 16, safe: 15, sig: 58, sl: 36, ss: 1,
    wx: { h: 74, iy: 20, tl: 59, tf: 20, temp: 26, cond: 38, m0: 50, ms: 8, src: 11 } },
  { font: 8.5, lh: 10.2, bar: 13, head: 12, row: 13, gap: 3, sum: 13.5, tot: 14, safe: 13.5, sig: 50, sl: 31, ss: 0.85,
    wx: { h: 64, iy: 18, tl: 53, tf: 18, temp: 24, cond: 34, m0: 44, ms: 7.5, src: 10 } },
  { font: 8, lh: 9.4, bar: 12, head: 11, row: 12, gap: 2, sum: 12, tot: 12.5, safe: 12.5, sig: 44, sl: 27, ss: 0.72,
    wx: { h: 58, iy: 17, tl: 49, tf: 16, temp: 22, cond: 31, m0: 40, ms: 7, src: 9 } },
];
const emptyRow = {
  received: () => ({ id: uid(), description: "", qty: "", uom: "", bolFiled: "" }),
  consumed: () => ({ id: uid(), description: "", qty: "", uom: "" }),
  manpower: () => ({ id: uid(), className: "", qty: "", hours: "", kind: "crew" }),
  sub: () => ({ id: uid(), description: "", details: "", crew: [emptyRow.subcrew()] }),
  subcrew: () => ({ id: uid(), className: "", kind: "crew", qty: "", hours: "" }),
  line: () => ({ id: uid(), text: "" }),
};

function freshSettings() {
  return {
    defaultName: "",
    defaultEmail: DEFAULT_EMAIL,
    lastProject: "",
    recentProjects: [],
    recentClasses: [],
    projectLocations: {},
    projectNames: {},
  };
}

function blankReport(settings) {
  const now = new Date().toISOString();
  const s = settings || freshSettings();
  return {
    id: uid(),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    date: todayISO(),
    projectNumber: s.lastProject || "",
    jobName: (s.projectNames || {})[s.lastProject] || "",
    printName: s.defaultName || "",
    summary: "",
    summaryLines: [emptyRow.line()],
    subsYN: "",
    weather: [],
    tempF: "",
    weatherImpact: "",
    weatherImpactExplain: "",
    jobCity: ((s.projectLocations || {})[s.lastProject] || {}).city || "",
    jobState: ((s.projectLocations || {})[s.lastProject] || {}).state || "",
    wx: null,
    delaysYN: "",
    delayHours: "",
    delays: "",
    received: [emptyRow.received()],
    consumed: [emptyRow.consumed()],
    manpower: [emptyRow.manpower()],
    subcontractors: [emptyRow.sub()],
    incidents: "",
    incidentsExplain: "",
    nearMiss: "",
    nearMissExplain: "",
    equipmentIssues: "",
    equipmentIssuesExplain: "",
    siteSecure: "",
    derailsDown: "",
    locksRemoved: "",
    jobBriefing: "",
    chocks: "",
    jobsiteClean: "",
    materialsSecured: "",
    photos: [],
    signatureDataUrl: "",
    recipientEmail: s.defaultEmail || DEFAULT_EMAIL,
    pdfTitle: "",
    pdfTitleCustom: false,
    layout: Object.assign({ size: "auto", ppp: 1 }, s.lastLayout || {}),
    jha: { on: false, front: null, back: null },
  };
}

let store = { reports: {}, order: [], settings: freshSettings() };
let screen = "home";
let activeId = null;
let step = 0;
let askSent = false;
let pendingDelete = null;
let pendingTimer = null;
let sigHandlers = null;
let preparedFiles = null;
let prepareToken = 0;
let prepareTimer = null;
let wxLoading = false;
let wxError = "";
let wxManualOpen = false;
let wxBusy = false;
let wxTimer = null;
let wxToken = 0;
let wxQueued = false;
let wxFailAt = 0;
let wxFailKey = "";
let placesPromise = null;
let dbPromise = null;
const thumbUrls = new Map();

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(PHOTO_STORE)) db.createObjectStore(PHOTO_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error || new Error("idb"));
    };
  });
  return dbPromise;
}

function idbDo(mode, run) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(PHOTO_STORE, mode);
    const req = run(tx.objectStore(PHOTO_STORE));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error || new Error("idb"));
    tx.onabort = () => reject(tx.error || new Error("idb"));
  }));
}

function putPhoto(id, blob) {
  return idbDo("readwrite", (photoStore) => photoStore.put(blob, id));
}
function getPhoto(id) {
  return idbDo("readonly", (photoStore) => photoStore.get(id));
}
function deletePhoto(id) {
  return idbDo("readwrite", (photoStore) => photoStore.delete(id)).catch(() => {});
}

function dataUrlToBlob(dataUrl) {
  const parts = String(dataUrl).split(",");
  const meta = parts[0] || "";
  const b64 = parts[1] || "";
  const mime = (meta.match(/data:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error);
    fr.readAsDataURL(blob);
  });
}

function inferKind(name) {
  const n = String(name || "").trim().toLowerCase();
  if (EQUIP_PRESETS.some((p) => p.toLowerCase() === n)) return "equip";
  return "crew";
}

function normalizeRecent(list) {
  if (!Array.isArray(list)) return [];
  const out = [];
  list.forEach((item) => {
    if (typeof item === "string") {
      const name = item.trim();
      if (name) out.push({ name: name, kind: "crew" });
      return;
    }
    if (!item || typeof item !== "object") return;
    const name = String(item.name || "").trim();
    if (!name) return;
    out.push({ name: name, kind: item.kind === "equip" ? "equip" : "crew" });
  });
  return out;
}

function syncSummary(r) {
  r.summary = (r.summaryLines || []).map((l) => String((l && l.text) || "").trim()).filter(Boolean).join("\n");
}

function summaryItems(r) {
  return (r.summaryLines || []).map((l) => String((l && l.text) || "").trim()).filter(Boolean);
}

function rememberJobName(r) {
  const proj = String((r && r.projectNumber) || "").trim();
  const name = String((r && r.jobName) || "").trim();
  if (!proj || !name) return;
  if (!store.settings.projectNames || typeof store.settings.projectNames !== "object") store.settings.projectNames = {};
  store.settings.projectNames[proj] = name;
}

function applySavedJobName() {
  const r = active();
  if (!r) return;
  const name = (store.settings.projectNames || {})[String(r.projectNumber || "").trim()];
  if (name && !String(r.jobName || "").trim()) { r.jobName = name; save(); }
}

function subsOn(r) {
  return r && r.subsYN === "yes";
}

function fillReport(r) {
  if (!Array.isArray(r.photos)) r.photos = [];
  if (!Array.isArray(r.received) || !r.received.length) r.received = [emptyRow.received()];
  if (!Array.isArray(r.consumed) || !r.consumed.length) r.consumed = [emptyRow.consumed()];
  if (!Array.isArray(r.manpower) || !r.manpower.length) r.manpower = [emptyRow.manpower()];
  if (!Array.isArray(r.subcontractors) || !r.subcontractors.length) r.subcontractors = [emptyRow.sub()];
  if (!Array.isArray(r.weather)) r.weather = [];
  if (r.tempF == null) r.tempF = "";
  if (r.weatherImpact == null) r.weatherImpact = "";
  if (r.weatherImpactExplain == null) r.weatherImpactExplain = "";
  if (r.jobCity == null) r.jobCity = "";
  r.jobState = String(r.jobState == null ? "" : r.jobState).replace(/[^A-Za-z]/g, "").slice(0, 2).toUpperCase();
  if (!r.wx || typeof r.wx !== "object") r.wx = null;
  r.wxManual = normManual(r.wxManual);
  if (r.jobName == null) r.jobName = "";
  if (!Array.isArray(r.summaryLines)) {
    const parts = String(r.summary || "").split(/\n+/).map((t) => t.replace(/^\s*(?:[-•*]|\d+[.)])\s+/, "").trim()).filter(Boolean);
    r.summaryLines = parts.length ? parts.map((t) => ({ id: uid(), text: t })) : [emptyRow.line()];
  }
  if (!r.summaryLines.length) r.summaryLines = [emptyRow.line()];
  syncSummary(r);
  r.subcontractors.forEach((sub) => {
    if (!Array.isArray(sub.crew)) {
      const h = String(sub.hours == null ? "" : sub.hours).trim();
      sub.crew = h ? [{ id: uid(), className: "Crew (total hours)", kind: "crew", qty: "1", hours: h }] : [emptyRow.subcrew()];
    }
    if (!sub.crew.length) sub.crew = [emptyRow.subcrew()];
    if (sub.details == null) sub.details = "";
  });
  if (r.subsYN == null) r.subsYN = r.subcontractors.some((x) => String(x.description || "").trim()) ? "yes" : "";
  CLOSEOUT.forEach((c) => { if (r[c[0]] == null) r[c[0]] = ""; });
  if (!r.jha || typeof r.jha !== "object") r.jha = { on: false, front: null, back: null };
  if (r.delaysYN == null) r.delaysYN = "";
  if (r.delayHours == null) r.delayHours = "";
  if (r.delays == null) r.delays = "";
  if (r.nearMiss == null) r.nearMiss = "";
  if (r.nearMissExplain == null) r.nearMissExplain = "";
  if (r.incidentsExplain == null) r.incidentsExplain = "";
  if (r.equipmentIssuesExplain == null) r.equipmentIssuesExplain = "";
  if (r.pdfTitle == null) r.pdfTitle = "";
  if (r.pdfTitleCustom == null) r.pdfTitleCustom = false;
  if (!r.delaysYN && String(r.delays || "").trim()) r.delaysYN = "yes";
  r.received.forEach((row) => { if (row.uom == null) row.uom = ""; });
  r.consumed.forEach((row) => { if (row.uom == null) row.uom = ""; });
  r.manpower.forEach((row) => {
    if (row.kind !== "crew" && row.kind !== "equip") row.kind = inferKind(row.className);
  });
  if ((r.recipientEmail || "").includes("stxrrailroad")) r.recipientEmail = DEFAULT_EMAIL;
}

async function load() {
  const rawText = localStorage.getItem(KEY);
  if (rawText) {
    let raw = null;
    try {
      raw = JSON.parse(rawText);
    } catch (e) {
      try { localStorage.setItem("stx-dps-backup-" + Date.now(), rawText); } catch (err) {}
      store = { reports: {}, order: [], settings: freshSettings() };
      try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (err) {}
      return;
    }
    if (raw && raw.reports) {
      store = {
        reports: raw.reports,
        order: Array.isArray(raw.order) ? raw.order : Object.keys(raw.reports),
        settings: { ...freshSettings(), ...(raw.settings || {}) },
      };
    }
  }
  if ((store.settings.defaultEmail || "").includes("stxrrailroad")) store.settings.defaultEmail = DEFAULT_EMAIL;
  if (!Array.isArray(store.settings.recentProjects)) store.settings.recentProjects = [];
  if (!Array.isArray(store.settings.recentClasses)) store.settings.recentClasses = [];
  store.settings.recentClasses = normalizeRecent(store.settings.recentClasses);
  if (!store.settings.projectLocations || typeof store.settings.projectLocations !== "object") store.settings.projectLocations = {};
  if (!store.settings.projectNames || typeof store.settings.projectNames !== "object" || Array.isArray(store.settings.projectNames)) store.settings.projectNames = {};
  const reports = Object.values(store.reports);
  for (let i = 0; i < reports.length; i += 1) {
    const r = reports[i];
    fillReport(r);
    const nextPhotos = [];
    for (let p = 0; p < r.photos.length; p += 1) {
      const photo = r.photos[p];
      if (!photo || !photo.id) continue;
      if (photo.dataUrl) {
        try {
          await putPhoto(photo.id, dataUrlToBlob(photo.dataUrl));
          nextPhotos.push({
            id: photo.id,
            caption: photo.caption || "",
            takenAt: photo.takenAt || new Date().toISOString(),
            ...(photo.skip ? { skip: true } : {}),
            ...(photo.group ? { group: photo.group } : {}),
          });
        } catch (err) {
          nextPhotos.push(photo);
        }
      } else {
        nextPhotos.push({ id: photo.id, caption: photo.caption || "", takenAt: photo.takenAt || "", ...(photo.skip ? { skip: true } : {}), ...(photo.group ? { group: photo.group } : {}) });
      }
    }
    r.photos = nextPhotos;
  }
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < reports.length; i += 1) {
    const r = reports[i];
    if (r.status !== "sent" || !r.sentAt) continue;
    const t = new Date(r.sentAt).getTime();
    if (!Number.isFinite(t) || t >= cutoff) continue;
    const jhaIds = jhaBlobIds(r);
    if (!r.photos.length && !jhaIds.length) continue;
    for (let p = 0; p < r.photos.length; p += 1) await deletePhoto(r.photos[p].id);
    for (let j = 0; j < jhaIds.length; j += 1) await deletePhoto(jhaIds[j]);
    if (r.photos.length) r.photosPurged = true;
    r.photos = [];
    if (jhaIds.length) r.jha = { on: r.jha.on, front: null, back: null, purged: true };
  }
  save();
  try { if (navigator.storage && navigator.storage.persist) navigator.storage.persist(); } catch (e) {}
}

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(store));
  } catch (e) {
    toast("Phone storage full. Delete old sent reports.");
  }
}

function toast(msg) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = "none"; }, 4000);
}

function list() {
  return store.order.map((id) => store.reports[id]).filter(Boolean);
}
function active() {
  return store.reports[activeId];
}
function patch(p) {
  const r = active();
  if (!r) return;
  Object.assign(r, p, { updatedAt: new Date().toISOString() });
  save();
}

function markSvg() {
  return '<div class="logo-chip"><img src="./stx-logo-v2.png" alt="STX Corporation" /></div>';
}
function uomList() {
  return '<datalist id="uom-options"><option value="EA"></option><option value="LF"></option><option value="TF"></option><option value="TN"></option><option value="CY"></option><option value="GAL"></option><option value="BAG"></option><option value="BDL"></option><option value="LB"></option><option value="SF"></option><option value="SY"></option></datalist>';
}
function field(label, inner) {
  return "<label>" + label + "</label>" + inner;
}
function input(name, value, extra) {
  return '<input data-k="' + name + '" value="' + esc(value || "") + '" ' + (extra || "") + " />";
}
function ta(name, value, ph) {
  return '<textarea data-k="' + name + '" placeholder="' + esc(ph || "") + '">' + esc(value || "") + "</textarea>";
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (ch) => {
    if (ch === "&") return "\u0026amp;";
    if (ch === "<") return "\u0026lt;";
    if (ch === ">") return "\u0026gt;";
    return "\u0026quot;";
  });
}

function teardownSig() {
  if (!sigHandlers) return;
  window.removeEventListener("pointerup", sigHandlers.end);
  window.removeEventListener("pointercancel", sigHandlers.end);
  if (sigHandlers.canvas) {
    sigHandlers.canvas.removeEventListener("pointerdown", sigHandlers.start);
    sigHandlers.canvas.removeEventListener("pointermove", sigHandlers.move);
  }
  sigHandlers = null;
}

function render() {
  let focusSel = "";
  let caret = null;
  const prev = document.activeElement;
  if (prev && prev.getAttribute) {
    const k = prev.getAttribute("data-k");
    const row = prev.getAttribute("data-row");
    const f = prev.getAttribute("data-f");
    const id = prev.getAttribute("data-id");
    const wxm = prev.getAttribute("data-wxmt");
    if (k) focusSel = '[data-k="' + k + '"]';
    else if (prev.getAttribute("data-subrow") && id && f) focusSel = '[data-subrow="' + prev.getAttribute("data-subrow") + '"][data-id="' + id + '"][data-f="' + f + '"]';
    else if (wxm != null && f) focusSel = '[data-wxmt="' + wxm + '"][data-f="' + f + '"]';
    else if (row && f && id) focusSel = '[data-row="' + row + '"][data-id="' + id + '"][data-f="' + f + '"]';
    if (focusSel && typeof prev.selectionStart === "number") caret = prev.selectionStart;
  }
  teardownSig();
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = screen === "home" ? homeHtml() : wizardHtml();
  bind();
  if (focusSel && document.querySelector) {
    const next = document.querySelector(focusSel);
    if (next && next.focus) {
      try {
        next.focus();
        if (caret != null && next.setSelectionRange) next.setSelectionRange(caret, caret);
      } catch (e) {}
    }
  }
  hydratePhotos();
  if (screen === "wizard" && (step === 1 || step === 6)) maybeAutoWeather();
  if (screen === "wizard" && step === 6) prepareSendFiles();
}

function homeHtml() {
  const items = list();
  const today = todayISO();
  const drafts = items.filter((r) => r.status === "draft");
  const sent = items.filter((r) => r.status === "sent");
  const todayDraft = drafts.some((r) => r.date === today);
  const s = store.settings;
  const group = (title, rows, empty) =>
    '<div class="card"><h2>' + title + "</h2>" +
    (rows.length ? rows.map((r) =>
      '<div class="list-row" data-open="' + r.id + '"><div><b>' + esc(r.projectNumber || "No project #") + "</b>" +
      '<div class="muted">' + esc(formatLong(r.date)) + (r.printName ? " · " + esc(r.printName) : "") + "</div></div>" +
      '<button class="btn btn-danger" style="width:auto;margin:0;padding:8px 10px;font-size:13px" data-del="' + r.id + '">' +
      (pendingDelete === r.id ? "Tap again to delete" : "Delete") + "</button></div>"
    ).join("") : '<p class="empty">' + empty + "</p>") +
    "</div>";
  return '<header class="hero">' + markSvg() +
    "<h1>Daily Project Summary</h1>" +
    '<p class="date">' + esc(formatLong(today)) + "</p></header>" +
    '<main class="content">' +
    (todayDraft ? '<button class="btn btn-navy" data-act="start">Continue today\'s report</button>' : "") +
    '<button class="btn ' + (todayDraft ? "btn-outline" : "btn-navy") + '" data-act="new">Start a new report</button>' +
    (items.length ? '<button class="btn btn-outline" data-act="fromlast">New from last crew</button>' : "") +
    group("Drafts", drafts, "No drafts. Start a report for the shift.") +
    group("Sent", sent, "Sent reports land here after you share them.") +
    '<div class="card"><h2>Supervisor defaults</h2>' +
    field("Your name", '<input data-set="defaultName" value="' + esc(s.defaultName) + '" placeholder="Print name on reports" autocomplete="name" autocapitalize="words" />') +
    field("Send reports to", '<input type="email" inputmode="email" data-set="defaultEmail" value="' + esc(s.defaultEmail) + '" placeholder="' + DEFAULT_EMAIL + '" />') +
    '<p class="hint">Office default is ' + DEFAULT_EMAIL + "</p></div>" +
    uomList() + "</main>";
}

function wizardHtml() {
  const r = active();
  if (!r) return homeHtml();
  return '<header class="hero" style="padding-bottom:14px"><div class="brand">' + markSvg() +
    "<div><small>Daily project summary</small></div></div>" +
    '<div class="muted" style="color:rgba(255,252,245,.75);margin-top:8px">' + STEPS[step] + " · " + (step + 1) + " of " + STEPS.length + "</div></header>" +
    '<main class="content">' + uomList() +
    '<div class="steps">' + STEPS.map((label, i) =>
      '<button type="button" data-step="' + i + '" aria-label="' + esc(label) + '"><i class="' + (i <= step ? "on" : "") + '"></i></button>'
    ).join("") + "</div>" +
    stepHtml(r) +
    '<div class="nav"><button class="btn btn-ghost" data-act="' + (step === 0 ? "home" : "back") + '">' + (step === 0 ? "Home" : "Back") + "</button>" +
    (step < STEPS.length - 1
      ? '<button class="btn btn-navy" data-act="next">Next</button>'
      : '<button class="btn btn-gold" data-act="preview">Preview PDF</button>') +
    "</div></main>";
}

const SLOT_TIMES = [
  { hour: 7, minute: 0, t: "7 AM" },
  { hour: 12, minute: 0, t: "12 PM" },
  { hour: 17, minute: 0, t: "5 PM" },
];
const PLACE_SUFFIXES = [" city and borough", " metropolitan government", " unified government", " consolidated government", " urban county", " municipality", " city", " town", " village", " cdp", " borough"];

function cleanPlaceName(name) {
  let n = String(name || "").trim().replace(/\s+/g, " ");
  const low = n.toLowerCase();
  for (let i = 0; i < PLACE_SUFFIXES.length; i += 1) {
    const s = PLACE_SUFFIXES[i];
    if (low.endsWith(s)) return n.slice(0, n.length - s.length).trim();
  }
  return n;
}

function placeKey(r) {
  return cleanPlaceName(r.jobCity || "").toLowerCase() + "|" + String(r.jobState || "").trim().toLowerCase() + "|" + (r.date || "");
}

function weatherDateOk(dateStr) {
  if (!dateStr) return false;
  const a = Date.parse(dateStr + "T12:00:00");
  const b = Date.parse(todayISO() + "T12:00:00");
  if (!Number.isFinite(a) || !Number.isFinite(b)) return false;
  const diff = Math.round((b - a) / 86400000);
  return diff >= 0 && diff <= 7;
}

function wxReady(r) {
  if (!r || !r.wx || r.wx.placeKey !== placeKey(r) || !weatherDateOk(r.date)) return false;
  return Array.isArray(r.wx.slots) && r.wx.slots.some((s) => s && (s.status === "ok" || s.status === "later" || s.status === "miss"));
}

function weatherFresh(r) {
  if (!wxReady(r) || !r.wx.fetchedAt) return false;
  const age = Date.now() - new Date(r.wx.fetchedAt).getTime();
  if (!Number.isFinite(age)) return false;
  const incomplete = r.wx.slots.some((s) => !s || s.status !== "ok");
  if (!incomplete) return true;
  if (step === 6) return age < 60 * 1000;
  return age < 3 * 60 * 1000;
}

function loadPlaces() {
  if (!placesPromise) {
    placesPromise = fetch("./us-places.json").then((res) => {
      if (!res.ok) throw new Error("places");
      return res.json();
    }).catch((err) => {
      placesPromise = null;
      throw err;
    });
  }
  return placesPromise;
}

function findPlace(list, city, state) {
  const name = cleanPlaceName(city).toLowerCase();
  const st = String(state || "").trim().toUpperCase();
  if (!name || st.length !== 2 || !Array.isArray(list)) return null;
  let best = null;
  for (let i = 0; i < list.length; i += 1) {
    const row = list[i];
    if (!row || row[1] !== st || String(row[0]).toLowerCase() !== name) continue;
    if (!best || (row[4] || 0) > (best[4] || 0)) best = row;
  }
  return best;
}

function fetchJson(url) {
  const ctrl = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timer = setTimeout(() => { if (ctrl) ctrl.abort(); }, 10000);
  return fetch(url, {
    signal: ctrl ? ctrl.signal : undefined,
    cache: "no-store",
    headers: { Accept: "application/geo+json" },
  }).then((res) => {
    if (!res.ok) throw new Error("http");
    return res.json();
  }).finally(() => clearTimeout(timer));
}

function zoneParts(date, timeZone) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timeZone, hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(date);
  const g = (type) => Number(parts.find((p) => p.type === type).value);
  let hour = g("hour");
  if (hour === 24) hour = 0;
  return { year: g("year"), month: g("month"), day: g("day"), hour: hour, minute: g("minute") };
}

function zonedTime(dateStr, hour, minute, timeZone) {
  const bits = String(dateStr).split("-").map(Number);
  const y = bits[0];
  const mo = bits[1];
  const d = bits[2];
  let utc = Date.UTC(y, mo - 1, d, hour, minute);
  for (let i = 0; i < 4; i += 1) {
    const p = zoneParts(new Date(utc), timeZone);
    const got = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    const want = Date.UTC(y, mo - 1, d, hour, minute);
    if (got === want) break;
    utc += want - got;
  }
  return utc;
}

function todayInZone(timeZone) {
  const p = zoneParts(new Date(), timeZone);
  const z = (n) => String(n).padStart(2, "0");
  return p.year + "-" + z(p.month) + "-" + z(p.day);
}

function slotIsFuture(dateStr, hour, minute, timeZone) {
  if (dateStr !== todayInZone(timeZone)) return false;
  return zonedTime(dateStr, hour, minute, timeZone) > Date.now();
}

function numVal(obj) {
  if (obj == null) return null;
  const v = typeof obj === "number" ? obj : obj.value;
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function compassDir(deg) {
  if (deg == null || !Number.isFinite(Number(deg))) return "";
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const i = Math.round((((Number(deg) % 360) + 360) % 360) / 45) % 8;
  return dirs[i];
}

function iconKind(url) {
  const m = String(url || "").match(/\/(day|night)\/([^?]+)/);
  if (!m) return "cloud";
  const day = m[1] !== "night";
  const parts = m[2].split("/").map((part) => part.split(",")[0].replace(/^wind_/, ""));
  const severe = (code) => {
    if (code === "tsra" || code === "tsra_sct" || code === "tsra_hi") return "storm";
    if (code === "rain" || code === "rain_showers" || code === "rain_showers_hi") return "rain";
    if (code === "snow" || code === "sleet" || code === "fzra" || code === "rain_snow") return "snow";
    if (code === "fog" || code === "haze" || code === "smoke" || code === "dust") return "fog";
    return "";
  };
  for (let i = 0; i < parts.length; i += 1) {
    const hit = severe(parts[i]);
    if (hit) return hit;
  }
  const code = parts[0] || "";
  if (code === "skc" || code === "few") return day ? "sun" : "moon";
  if (code === "sct" || code === "bkn") return day ? "partly-day" : "partly-night";
  if (code === "ovc") return "cloud";
  return "cloud";
}

function closestObs(features, targetMs) {
  let best = null;
  let bestDt = Infinity;
  (features || []).forEach((f) => {
    const ts = Date.parse(f && f.properties && f.properties.timestamp);
    if (!Number.isFinite(ts)) return;
    const dt = Math.abs(ts - targetMs);
    if (dt < bestDt) { bestDt = dt; best = f; }
  });
  if (!best || bestDt > 45 * 60 * 1000) return null;
  return best;
}

function blankSlot(t, status, cond) {
  return { t: t, status: status, icon: "", cond: cond, tempF: "", precip: "", wind: "", hum: "", obsTime: "" };
}

function buildSlot(target, dateStr, tz, features) {
  if (slotIsFuture(dateStr, target.hour, target.minute, tz)) return blankSlot(target.t, "later", "Later today.");
  const obs = closestObs(features, zonedTime(dateStr, target.hour, target.minute, tz));
  if (!obs) return blankSlot(target.t, "miss", "No reading.");
  const p = obs.properties || {};
  const tempC = numVal(p.temperature);
  const windK = numVal(p.windSpeed);
  const windDir = numVal(p.windDirection);
  const hum = numVal(p.relativeHumidity);
  const precipMm = numVal(p.precipitationLastHour);
  const mph = windK == null ? null : Math.round(windK * 0.621371);
  let wind = "—";
  if (mph != null) wind = mph <= 0 ? "0 mph" : ((compassDir(windDir) ? compassDir(windDir) + " " : "") + mph + " mph");
  return {
    t: target.t,
    status: "ok",
    icon: iconKind(p.icon),
    cond: p.textDescription || "",
    tempF: tempC == null ? "" : String(Math.round(tempC * 9 / 5 + 32)),
    precip: precipMm == null ? "—" : (precipMm / 25.4).toFixed(2) + " in",
    wind: wind,
    hum: hum == null ? "—" : String(Math.round(hum)) + "%",
    obsTime: p.timestamp || "",
  };
}

function maybeAutoWeather() {
  if (wxBusy || wxQueued) return;
  const r = active();
  if (!r || !weatherDateOk(r.date)) return;
  if (!String(r.jobCity || "").trim() || String(r.jobState || "").trim().length < 2) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  if (weatherFresh(r)) return;
  const key = placeKey(r);
  const wait = step === 6 ? 20000 : 120000;
  if (wxFailKey === key && wxFailAt && Date.now() - wxFailAt < wait) return;
  wxQueued = true;
  setTimeout(() => {
    wxQueued = false;
    if (screen !== "wizard" || (step !== 1 && step !== 6)) return;
    fetchWeather(false);
  }, 40);
}

function scheduleWeather() {
  clearTimeout(wxTimer);
  wxTimer = setTimeout(() => { fetchWeather(false); }, 450);
}

async function fetchWeather(force) {
  const r = active();
  if (!r) return;
  if (wxBusy && !force) return;
  if (!weatherDateOk(r.date)) return;
  const city = String(r.jobCity || "").trim();
  const state = String(r.jobState || "").trim().toUpperCase();
  if (!city || state.length !== 2) return;
  if (!force && weatherFresh(r)) return;
  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    wxError = "Weather unavailable. No signal.";
    wxManualOpen = true;
    wxLoading = false;
    wxFailKey = placeKey(r);
    wxFailAt = Date.now();
    render();
    return;
  }
  const token = ++wxToken;
  const reportId = r.id;
  const key = placeKey(r);
  wxBusy = true;
  wxLoading = true;
  wxError = "";
  render();
  try {
    const list = await loadPlaces();
    if (token !== wxToken) return;
    const place = findPlace(list, city, state);
    if (!place) {
      const live = active();
      if (live && live.id === reportId) live.wx = null;
      wxError = "City not found. Check spelling.";
      wxManualOpen = true;
      wxFailKey = key;
      wxFailAt = Date.now();
      return;
    }
    const lat = Math.round(place[2] * 10000) / 10000;
    const lon = Math.round(place[3] * 10000) / 10000;
    const points = await fetchJson("https://api.weather.gov/points/" + lat + "," + lon);
    if (token !== wxToken) return;
    const props = (points && points.properties) || {};
    const tz = props.timeZone || "America/Chicago";
    if (!props.observationStations) throw new Error("stations");
    const stations = await fetchJson(props.observationStations);
    if (token !== wxToken) return;
    const start = new Date(zonedTime(r.date, 6, 0, tz)).toISOString();
    const end = new Date(zonedTime(r.date, 18, 0, tz)).toISOString();
    // The nearest station is sometimes offline or missing hours. Try up to 5 nearby
    // stations and keep the one with the most readings.
    const feats = (stations && stations.features) || [];
    let first = null;
    let slots = null;
    let bestOk = -1;
    for (let si = 0; si < feats.length && si < 5; si += 1) {
      const st = feats[si] && feats[si].properties;
      if (!st || !st.stationIdentifier) continue;
      let obs = null;
      try {
        obs = await fetchJson("https://api.weather.gov/stations/" + encodeURIComponent(st.stationIdentifier) + "/observations?start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end));
      } catch (e) { continue; }
      if (token !== wxToken) return;
      const trySlots = SLOT_TIMES.map((target) => buildSlot(target, r.date, tz, (obs && obs.features) || []));
      const due = trySlots.filter((x) => x.status !== "later").length;
      const ok = trySlots.filter((x) => x.status === "ok" && x.tempF !== "").length;
      if (ok > bestOk) { bestOk = ok; first = st; slots = trySlots; }
      if (ok >= due) break;
    }
    if (!first || !slots) throw new Error("station");
    const live = active();
    if (!live || live.id !== reportId || placeKey(live) !== key) return;
    live.wx = {
      lat: lat,
      lon: lon,
      tz: tz,
      station: first.stationIdentifier,
      stationName: first.name || "",
      fetchedAt: new Date().toISOString(),
      placeKey: key,
      slots: slots,
    };
    rememberLocation(live);
    save();
    wxError = "";
    wxFailAt = 0;
    wxFailKey = "";
  } catch (err) {
    if (token !== wxToken) return;
    wxError = (typeof navigator !== "undefined" && navigator.onLine === false)
      ? "Weather unavailable. No signal."
      : "Couldn't reach the weather service. Tap Refresh to try again, or enter the weather below.";
    wxManualOpen = true;
    wxFailKey = key;
    wxFailAt = Date.now();
  } finally {
    if (token === wxToken) {
      wxBusy = false;
      wxLoading = false;
      render();
    }
  }
}

function rememberLocation(r) {
  if (!r) return;
  const project = String(r.projectNumber || "").trim();
  const city = String(r.jobCity || "").trim();
  const state = String(r.jobState || "").trim().toUpperCase();
  if (!project || !city || state.length !== 2) return;
  if (!store.settings.projectLocations || typeof store.settings.projectLocations !== "object" || Array.isArray(store.settings.projectLocations)) {
    store.settings.projectLocations = {};
  }
  const prev = store.settings.projectLocations[project];
  if (prev && prev.city === city && String(prev.state || "").toUpperCase() === state) return;
  store.settings.projectLocations[project] = { city: city, state: state };
}

function applySavedLocation() {
  const r = active();
  if (!r) return;
  const loc = (store.settings.projectLocations || {})[String(r.projectNumber || "").trim()];
  if (!loc) return;
  const city = loc.city || "";
  const state = String(loc.state || "").toUpperCase();
  if (r.jobCity === city && r.jobState === state) return;
  r.jobCity = city;
  r.jobState = state;
  r.wx = null;
  wxError = "";
  wxFailAt = 0;
  wxFailKey = "";
  save();
}

function wxSvg(kind) {
  const ray = (cx, cy, inner, outer) => {
    let s = "";
    for (let a = 0; a < 360; a += 45) {
      const r = a * Math.PI / 180;
      s += '<line x1="' + (cx + inner * Math.cos(r)).toFixed(1) + '" y1="' + (cy + inner * Math.sin(r)).toFixed(1) + '" x2="' + (cx + outer * Math.cos(r)).toFixed(1) + '" y2="' + (cy + outer * Math.sin(r)).toFixed(1) + '" stroke="#ffd66e" stroke-width="1.8" stroke-linecap="round"/>';
    }
    return s;
  };
  const sun = (cx, cy, rad, inner, outer) => '<circle cx="' + cx + '" cy="' + cy + '" r="' + rad + '" fill="#ffd66e"/>' + ray(cx, cy, inner, outer);
  const moon = '<circle cx="18" cy="20" r="9" fill="#a7bfdc"/><circle cx="23" cy="16" r="8" fill="#fff"/>';
  const cloudShape = (fill, grow) => {
    const g = grow || 0;
    return '<g fill="' + fill + '"><circle cx="14" cy="22" r="' + (6 + g) + '"/><circle cx="21" cy="17" r="' + (8 + g) + '"/><circle cx="28" cy="23" r="' + (5 + g) + '"/><rect x="' + (9 - g) + '" y="22" width="' + (22 + g * 2) + '" height="' + (6 + g) + '" rx="3"/></g>';
  };
  const cloud = (fill, stroke) => (stroke ? cloudShape(stroke, 1.3) : "") + cloudShape(fill, 0);
  let body = cloud("#9aa5b1");
  if (kind === "sun") body = sun(20, 20, 7, 10, 14);
  else if (kind === "moon") body = moon;
  else if (kind === "partly-day") body = sun(12, 12, 5, 7, 10) + cloud("#fff", "#9aa5b1");
  else if (kind === "partly-night") body = '<circle cx="12" cy="14" r="7" fill="#a7bfdc"/><circle cx="16" cy="11" r="6" fill="#fff"/>' + cloud("#fff", "#9aa5b1");
  else if (kind === "rain") body = cloud("#9aa5b1") + '<g stroke="#5b8fd9" stroke-width="1.6" stroke-linecap="round"><line x1="14" y1="30" x2="12" y2="36"/><line x1="20" y1="30" x2="18" y2="36"/><line x1="26" y1="30" x2="24" y2="36"/></g>';
  else if (kind === "storm") body = cloud("#9aa5b1") + '<polygon points="21,20 16,28 20,28 17,36 26,26 21,26" fill="#e0a800"/>' + '<g stroke="#5b8fd9" stroke-width="1.6" stroke-linecap="round"><line x1="14" y1="32" x2="12" y2="37"/><line x1="27" y1="32" x2="25" y2="37"/></g>';
  else if (kind === "snow") body = cloud("#9aa5b1") + '<g fill="#5b8fd9"><circle cx="14" cy="33" r="1.4"/><circle cx="20" cy="35" r="1.4"/><circle cx="26" cy="33" r="1.4"/></g>';
  else if (kind === "fog") body = '<g fill="#9aa5b1"><rect x="8" y="12" width="24" height="3" rx="1.5"/><rect x="8" y="19" width="24" height="3" rx="1.5"/><rect x="8" y="26" width="24" height="3" rx="1.5"/></g>';
  return '<svg class="wx-ico" viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">' + body + "</svg>";
}

const MANUAL_CONDS = [
  ["sun", "Sunny"], ["partly-day", "Partly cloudy"], ["cloud", "Cloudy"], ["rain", "Rain"],
  ["storm", "Storms"], ["fog", "Fog"], ["snow", "Snow/Ice"], ["moon", "Clear night"],
];

function normManual(list) {
  const src = Array.isArray(list) ? list : [];
  return SLOT_TIMES.map((t, i) => {
    const m = src[i] && typeof src[i] === "object" ? src[i] : {};
    return { icon: String(m.icon || ""), tempF: String(m.tempF == null ? "" : m.tempF), wind: String(m.wind || "") };
  });
}

function manualFilled(m) {
  return !!(m && (m.icon || String(m.tempF || "").trim()));
}

// Merge observed readings with anything the supervisor typed in.
// Observed wins; a manual entry fills any hour the station missed.
function effSlots(r) {
  const obs = (r && r.wx && r.wx.placeKey === placeKey(r) && Array.isArray(r.wx.slots)) ? r.wx.slots : [];
  const man = normManual(r && r.wxManual);
  return SLOT_TIMES.map((t, i) => {
    const o = obs[i];
    if (o && o.status === "ok" && o.tempF !== "") return Object.assign({}, o, { src: "nws" });
    const m = man[i];
    if (manualFilled(m)) {
      const c = MANUAL_CONDS.find((x) => x[0] === m.icon);
      const temp = String(m.tempF || "").replace(/[^0-9-]/g, "");
      return { t: t.t, status: "ok", src: "manual", icon: m.icon || "", cond: c ? c[1] : "", tempF: temp, precip: "—", wind: String(m.wind || "").trim() || "—", hum: "—", obsTime: "" };
    }
    if (o) return Object.assign({}, o, { src: "nws" });
    return Object.assign(blankSlot(t.t, "miss", "No reading."), { src: "" });
  });
}

function hasWeatherStrip(r) {
  return effSlots(r).some((x) => x.status === "ok");
}

function weatherSource(r) {
  const slots = effSlots(r);
  const nws = slots.some((x) => x.status === "ok" && x.src === "nws");
  const manTimes = slots.filter((x) => x.status === "ok" && x.src === "manual").map((x) => x.t);
  const parts = [];
  if (nws && r.wx) parts.push("National Weather Service · Station " + (r.wx.station || "") + (r.wx.stationName ? " (" + r.wx.stationName + ")" : "") + " · observed readings");
  if (manTimes.length) parts.push((manTimes.length === 3 ? "All times" : manTimes.join(", ")) + " entered by supervisor on site");
  return "Source: " + (parts.join(" · ") || "—");
}

function manualEditor(r) {
  const man = normManual(r.wxManual);
  return '<div class="wxm"><p class="hint" style="margin:10px 0 6px">Enter the weather by hand for any time that is missing. Tap a condition, then the temperature.</p>' +
    SLOT_TIMES.map((t, i) => {
      const m = man[i];
      return '<div class="wxm-row"><div class="wxm-time">' + t.t + "</div>" +
        '<div class="wxm-conds">' + MANUAL_CONDS.map((c) =>
          '<button type="button" class="wxm-chip' + (m.icon === c[0] ? " on" : "") + '" data-wxm="' + i + '" data-icon="' + c[0] + '">' +
          wxSvg(c[0]) + "<span>" + c[1] + "</span></button>").join("") + "</div>" +
        '<div class="row"><div>' + field("Temp °F", '<input inputmode="numeric" data-wxmt="' + i + '" data-f="tempF" value="' + esc(m.tempF) + '" placeholder="°F" />') +
        "</div><div>" + field("Wind", '<input data-wxmt="' + i + '" data-f="wind" value="' + esc(m.wind) + '" placeholder="e.g. S 10 mph" />') +
        "</div></div></div>";
    }).join("") + "</div>";
}

function slotHtml(slot) {
  const label = esc((slot && slot.t) || "");
  if (!slot || slot.status === "later") return '<div class="wx-col"><div class="wx-time">' + label + '</div><div class="wx-cond">Later today.</div></div>';
  if (slot.status !== "ok") return '<div class="wx-col"><div class="wx-time">' + label + '</div><div class="wx-cond">No reading.</div></div>';
  const temp = slot.tempF === "" || slot.tempF == null ? "—" : slot.tempF + "°";
  const meta = slot.src === "manual"
    ? "Wind " + esc(slot.wind || "—") + "<br><i>Entered on site</i>"
    : "Precip " + esc(slot.precip || "—") + "<br>Wind " + esc(slot.wind || "—") + "<br>Humidity " + esc(slot.hum || "—");
  return '<div class="wx-col"><div class="wx-time">' + label + "</div>" + (slot.icon ? wxSvg(slot.icon) : '<div class="wx-ico"></div>') +
    '<div class="wx-temp">' + esc(temp) + "</div>" +
    '<div class="wx-cond">' + esc(slot.cond || "") + "</div>" +
    '<div class="wx-meta">' + meta + "</div></div>";
}

function weatherCard(r) {
  const cityRow = '<div class="row loc"><div>' +
    field("Job city", input("jobCity", r.jobCity, 'placeholder="Houston" autocapitalize="words"')) +
    "</div><div>" +
    field("State", '<input data-k="jobState" value="' + esc(r.jobState || "") + '" maxlength="2" autocapitalize="characters" placeholder="TX" />') +
    "</div></div>";
  const hasCity = !!String(r.jobCity || "").trim() && String(r.jobState || "").trim().length >= 2;
  const dateOk = weatherDateOk(r.date);
  const slots = effSlots(r);
  const anyOk = slots.some((x) => x.status === "ok");
  const missing = slots.some((x) => x.status === "miss" || (x.status === "ok" && x.tempF === ""));
  let body = "";
  if (dateOk) {
    body += '<button type="button" class="btn btn-outline" data-act="wxrefresh"' + (wxLoading ? " disabled" : "") + ">" +
      (wxLoading ? '<i class="spin"></i> Loading weather…' : "Refresh weather") + "</button>";
  } else {
    body += '<p class="hint">Live weather is only available for the last 7 days. Enter it below.</p>';
  }
  if (wxError) body += '<p class="hint wx-err">' + esc(wxError) + "</p>";
  if (!hasCity) body += '<p class="hint">Enter the job city and state.</p>';
  if (anyOk || (r.wx && r.wx.placeKey === placeKey(r))) {
    body += '<div class="wx-grid">' + slots.map(slotHtml).join("") + "</div>";
    if (anyOk) body += '<p class="wx-src">' + esc(weatherSource(r)) + "</p>";
  }
  const showEditor = wxManualOpen || !!wxError || !dateOk || missing || (hasCity && !anyOk && !wxLoading);
  if (showEditor) body += manualEditor(r);
  else if (anyOk) body += '<button type="button" class="btn btn-ghost" data-act="wxmanual">Enter weather by hand</button>';
  return '<div class="card"><h2>Weather</h2>' + cityRow + body +
    ynRow("Did weather affect work today?", "weatherImpact", r.weatherImpact || "") +
    (r.weatherImpact === "yes" ? field("Explain", ta("weatherImpactExplain", r.weatherImpactExplain, "How did weather affect the work")) : "") +
    "</div>";
}

function splitRow(left, right) {
  return '<div class="row"><div>' + left + "</div><div>" + right + "</div></div>";
}

function stepHtml(r) {
  if (step === 0) {
    return '<div class="card"><h2>Job information</h2>' +
      field("Job name", input("jobName", r.jobName, 'placeholder="e.g. Englewood Yard Tie Program" autocapitalize="words"')) +
      field("Job number", input("projectNumber", r.projectNumber, 'placeholder="Job number" inputmode="numeric"')) +
      recentChips() +
      field("Date", '<input type="date" data-k="date" value="' + esc(r.date) + '" />') +
      field("Print name", input("printName", r.printName, 'placeholder="Your name" autocomplete="name" autocapitalize="words"')) +
      "</div>";
  }
  if (step === 1) {
    return '<div class="card"><h2>Summary of work performed</h2>' +
      '<p class="hint">One item per line. Press Enter or tap Add line for the next item.</p>' +
      r.summaryLines.map((l, i) => '<div class="sline"><span class="snum">' + (i + 1) + ".</span>" +
        '<input data-row="summaryLines" data-id="' + l.id + '" data-f="text" value="' + esc(l.text) + '" placeholder="' + (i === 0 ? "e.g. Replaced 42 crossties MP 112.4 to 112.9" : "Next item") + '" enterkeyhint="next" />' +
        '<button type="button" class="sline-x" data-rm="summaryLines" data-id="' + l.id + '" aria-label="Remove line">×</button></div>').join("") +
      '<button class="btn btn-ghost" data-add="summaryLines">Add line</button>' +
      "</div>" +
      weatherCard(r) +
      '<div class="card"><h2>Delays / interruptions</h2>' +
      ynRow("Any delays today?", "delaysYN", r.delaysYN || "") +
      (r.delaysYN === "yes"
        ? field("Hours lost", '<input inputmode="decimal" data-k="delayHours" value="' + esc(r.delayHours || "") + '" />') +
          field("Explain", ta("delays", r.delays, "Train traffic, weather, waiting on materials…"))
        : "") +
      "</div>";
  }
  if (step === 2) {
    return materialBlock("Received and accounted materials", "received", r.received, true) +
      materialBlock("Materials consumed", "consumed", r.consumed, false);
  }
  if (step === 3) {
    const rec = normalizeRecent(store.settings.recentClasses).filter((c) => !PRESETS.some((p) => p.toLowerCase() === c.name.toLowerCase()));
    return '<div class="card"><h2>Manpower and equipment</h2>' +
      '<p class="hint">Tap a class, or Other to write one in. Crew counts as man-hours. Equipment does not.</p>' +
      '<div class="chips">' +
      PRESETS.map((n) => '<button type="button" class="chip" data-preset="' + esc(n) + '" data-kind="' + inferKind(n) + '">' + esc(n) + "</button>").join("") +
      rec.map((c) => '<button type="button" class="chip recent" data-preset="' + esc(c.name) + '" data-kind="' + (c.kind === "equip" ? "equip" : "crew") + '">' + esc(c.name) + "</button>").join("") +
      '<button type="button" class="chip other" data-act="other">Other</button></div>' +
      r.manpower.map((row) => '<div class="item"><div class="item-top"><span class="muted">Class / equipment</span>' +
        '<button class="btn btn-danger" style="width:auto;margin:0;padding:6px 10px;font-size:12px" data-rm="manpower" data-id="' + row.id + '">Remove</button></div>' +
        '<input data-row="manpower" data-id="' + row.id + '" data-f="className" value="' + esc(row.className) + '" placeholder="Write in any class or equipment" autocapitalize="words" />' +
        kindToggle(row) +
        splitRow(
          field("QTY", '<input inputmode="decimal" data-row="manpower" data-id="' + row.id + '" data-f="qty" value="' + esc(row.qty) + '" />'),
          field("Hours", '<input inputmode="decimal" data-row="manpower" data-id="' + row.id + '" data-f="hours" value="' + esc(row.hours) + '" />')
        ) +
        "</div></div>").join("") +
      '<button class="btn btn-ghost" data-add="manpower">Add another class / equipment</button></div>' +
      subsCard(r);
  }
  if (step === 4) {
    return ynCard("Any incidents today?", "incidents", r.incidents, "incidentsExplain", r.incidentsExplain, "yes") +
      ynCard("Any near misses today?", "nearMiss", r.nearMiss, "nearMissExplain", r.nearMissExplain, "yes") +
      ynCard("Any equipment issues today?", "equipmentIssues", r.equipmentIssues, "equipmentIssuesExplain", r.equipmentIssuesExplain, "yes") +
      '<div class="card"><h2>Closeout checklist</h2><p class="hint">Use N/A when an item does not apply to this job.</p>' +
      CLOSEOUT.map((c) => ynaRow(c[1], c[0], r[c[0]] || "")).join("") +
      "</div>";
  }
  if (step === 5) {
    const purgedNote = !!r.photosPurged && !(r.photos || []).length;
    return jhaCard(r) + '<div class="card"><h2>Job photos</h2>' +
      (purgedNote
        ? '<p class="hint">Photos removed from phone after 14 days (sent copy is on file).</p>'
        : '<p class="hint">Add 3–4 photos. Take a new one or pick from your camera roll, then add a short note on each.</p>') +
      '<div class="nav" style="margin:0 0 12px">' +
      '<button class="btn btn-navy" data-act="photo" style="margin:0">Take photo</button>' +
      '<button class="btn btn-outline" data-act="library" style="margin:0">From library</button></div>' +
      '<input id="photoFile" type="file" accept="image/*" capture="environment" hidden />' +
      '<input id="libraryFile" type="file" accept="image/*" multiple hidden />' +
      (r.photos.map((p, i) => '<div class="item">' +
        '<img data-photo="' + esc(p.id) + '" alt="Photo ' + (i + 1) + '" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#ddd" />' +
        "<label>Photo " + (i + 1) + " notes</label>" +
        '<input data-caption="' + p.id + '" value="' + esc(p.caption || "") + '" placeholder="What does this show?" />' +
        '<button class="btn btn-danger" data-rmphoto="' + p.id + '">Remove</button></div>').join("") ||
        (purgedNote ? "" : '<p class="empty">No photos yet.</p>')) +
      "</div>";
  }
  return '<div class="card"><h2>Sign and send</h2>' +
    field("Print name", input("printName", r.printName, 'placeholder="Your name"')) +
    field("PDF file name", '<input data-k="pdfTitle" value="' + esc(r.pdfTitle || autoTitle(r)) + '" placeholder="25125- 260913 Matt" />') +
    '<p class="hint">Office format is project- YYMMDD firstname, like 25125- 260913 Matt. Edit if you need Matt instead of Matthew.</p>' +
    field("Email to", '<input type="email" inputmode="email" data-k="recipientEmail" value="' + esc(r.recipientEmail) + '" />') +
    '<p class="hint">This goes out with the report to ' + DEFAULT_EMAIL + "</p>" +
    "<label>Signature</label>" +
    '<canvas class="sig" id="sig"></canvas>' +
    '<button class="btn btn-ghost" data-act="clearsig">Clear signature</button></div>' +
    layoutCard(r);
}

function layoutCard(r) {
  const L = layoutOf(r);
  const seg = (attr, cur, opts) => '<div class="seg">' + opts.map((o) =>
    '<button type="button" data-' + attr + '="' + o[0] + '" class="' + (String(cur) === String(o[0]) ? "on" : "") + '">' + o[1] + "</button>").join("") + "</div>";
  return '<div class="card"><h2>Report layout</h2>' +
    "<label>Text size</label>" +
    seg("lsize", L.size, [["auto", "Auto-fit"], [0, "Normal"], [1, "Compact"], [2, "Tight"]]) +
    '<p class="layout-status" id="layoutStatus">Checking layout…</p>' +
    '<p class="hint">Auto-fit shrinks the text just enough to keep the report on one page.</p>' +
    photoPagesCard(r) +
    "</div>" +
    '<p class="hint" style="text-align:center">Tap <b>Preview PDF</b>, then use Share in the preview to email it. The office email is copied so you can paste it.</p>' +
    '<button class="btn btn-ghost" data-act="sent-yes">Mark as sent</button>';
}

function subsCard(r) {
  let body = ynRow("Any subcontractors on site today?", "subsYN", r.subsYN || "");
  if (r.subsYN === "no") body += '<p class="hint">No subcontractors today. This section will be left off the report.</p>';
  if (r.subsYN === "yes") {
    body += r.subcontractors.map((sub, si) => '<div class="item sub"><div class="item-top"><span class="muted">Subcontractor ' + (si + 1) + "</span>" +
      '<button class="btn btn-danger" style="width:auto;margin:0;padding:6px 10px;font-size:12px" data-rm="subcontractors" data-id="' + sub.id + '">Remove</button></div>' +
      '<input data-row="subcontractors" data-id="' + sub.id + '" data-f="description" value="' + esc(sub.description) + '" placeholder="Company name" autocapitalize="words" />' +
      field("Work performed", '<input data-row="subcontractors" data-id="' + sub.id + '" data-f="details" value="' + esc(sub.details || "") + '" placeholder="e.g. Thermite welds" />') +
      '<div class="subcrew-h">Their manpower and equipment</div>' +
      (sub.crew || []).map((row) => '<div class="subcrew"><div class="item-top"><span class="muted">Class / equipment</span>' +
        '<button type="button" class="sline-x" data-subrm="' + sub.id + "|" + row.id + '" aria-label="Remove">×</button></div>' +
        '<input data-subrow="' + sub.id + '" data-id="' + row.id + '" data-f="className" value="' + esc(row.className) + '" placeholder="e.g. Welder, Laborer, Boom truck" autocapitalize="words" />' +
        subKindToggle(sub.id, row) +
        splitRow(
          field("QTY", '<input inputmode="decimal" data-subrow="' + sub.id + '" data-id="' + row.id + '" data-f="qty" value="' + esc(row.qty) + '" />'),
          field("Hours", '<input inputmode="decimal" data-subrow="' + sub.id + '" data-id="' + row.id + '" data-f="hours" value="' + esc(row.hours) + '" />')
        ) + "</div>").join("") +
      '<button class="btn btn-ghost" data-subadd="' + sub.id + '">Add crew or equipment</button></div>').join("") +
      '<button class="btn btn-outline" data-add="subcontractors">Add another subcontractor</button>';
  }
  return '<div class="card"><h2>Subcontractors</h2>' + body + "</div>";
}

function recentChips() {
  const rec = store.settings.recentProjects || [];
  if (!rec.length) return "";
  const names = store.settings.projectNames || {};
  return '<div class="chips">' + rec.map((p) => '<button type="button" class="chip" data-proj="' + esc(p) + '">' + esc(p) + (names[p] ? " · " + esc(names[p]) : "") + "</button>").join("") + "</div>";
}
function ynCard(title, key, val, explainKey, explain, alertYes) {
  return '<div class="card"><h2>' + title + "</h2>" + ynRow("", key, val, alertYes) +
    (val === "yes" ? field("Explain", ta(explainKey, explain, "What happened")) : "") + "</div>";
}
function ynRow(label, key, val, alertOn) {
  const yesOn = val === "yes" ? (alertOn === "yes" ? "on-alert" : "on") : "";
  const noOn = val === "no" ? (alertOn === "no" ? "on-alert" : "on") : "";
  return (label ? "<label>" + label + "</label>" : "") + '<div class="yn">' +
    '<button type="button" data-yn="' + key + '" data-v="yes" class="' + yesOn + '">Yes</button>' +
    '<button type="button" data-yn="' + key + '" data-v="no" class="' + noOn + '">No</button></div>';
}
function ynaRow(label, key, val) {
  const cls = (v) => (val !== v ? "" : (v === "no" ? "on-alert" : v === "na" ? "on-na" : "on"));
  return "<label>" + label + '</label><div class="yn yn3">' +
    [["yes", "Yes"], ["no", "No"], ["na", "N/A"]].map((o) =>
      '<button type="button" data-yn="' + key + '" data-v="' + o[0] + '" class="' + cls(o[0]) + '">' + o[1] + "</button>").join("") +
    "</div>";
}
function subKindToggle(subId, row) {
  const kind = row.kind === "equip" ? "equip" : "crew";
  return '<div class="kind">' +
    '<button type="button" data-subkind="' + subId + "|" + row.id + '" data-v="crew" class="' + (kind === "crew" ? "on" : "") + '">Crew</button>' +
    '<button type="button" data-subkind="' + subId + "|" + row.id + '" data-v="equip" class="' + (kind === "equip" ? "on" : "") + '">Equipment</button></div>';
}
function kindToggle(row) {
  const kind = row.kind === "equip" ? "equip" : "crew";
  return '<div class="kind">' +
    '<button type="button" data-kindrow="' + row.id + '" data-v="crew" class="' + (kind === "crew" ? "on" : "") + '">Crew</button>' +
    '<button type="button" data-kindrow="' + row.id + '" data-v="equip" class="' + (kind === "equip" ? "on" : "") + '">Equipment</button></div>';
}

function materialBlock(title, key, rows, bol) {
  return '<div class="card"><h2>' + title + "</h2>" +
    rows.map((row) => '<div class="item"><div class="item-top"><span class="muted">Item</span>' +
      '<button class="btn btn-danger" style="width:auto;margin:0;padding:6px 10px;font-size:12px" data-rm="' + key + '" data-id="' + row.id + '">Remove</button></div>' +
      '<input data-row="' + key + '" data-id="' + row.id + '" data-f="description" value="' + esc(row.description) + '" placeholder="Description" />' +
      splitRow(
        field("QTY", '<input inputmode="decimal" data-row="' + key + '" data-id="' + row.id + '" data-f="qty" value="' + esc(row.qty) + '" />'),
        field("UOM", '<input data-row="' + key + '" data-id="' + row.id + '" data-f="uom" value="' + esc(row.uom || "") + '" list="uom-options" placeholder="EA, LF, TN" autocapitalize="characters" />')
      ) +
      (bol ? field("BOL filed", '<select data-row="' + key + '" data-id="' + row.id + '" data-f="bolFiled">' +
        '<option value="" ' + (row.bolFiled === "" ? "selected" : "") + "></option>" +
        '<option value="yes" ' + (row.bolFiled === "yes" ? "selected" : "") + ">Yes</option>" +
        '<option value="no" ' + (row.bolFiled === "no" ? "selected" : "") + ">No</option></select>") : "") +
      "</div>").join("") +
    '<button class="btn btn-ghost" data-add="' + key + '">Add item</button></div>';
}

function bind() {
  document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", onAct));
  document.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.closest("[data-del]")) return;
    openReport(el.getAttribute("data-open"));
  }));
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    e.preventDefault();
    const id = b.getAttribute("data-del");
    if (pendingDelete && pendingDelete !== id) {
      const prev = document.querySelector('[data-del="' + pendingDelete + '"]');
      if (prev) prev.textContent = "Delete";
    }
    if (pendingDelete !== id) {
      pendingDelete = id;
      b.textContent = "Tap again to delete";
      clearTimeout(pendingTimer);
      pendingTimer = setTimeout(() => {
        if (pendingDelete === id) pendingDelete = null;
        const live = document.querySelector('[data-del="' + id + '"]');
        if (live) live.textContent = "Delete";
      }, 3000);
      return;
    }
    clearTimeout(pendingTimer);
    pendingDelete = null;
    removeReport(id);
  }));
  document.querySelectorAll("[data-set]").forEach((el) => el.addEventListener("input", () => {
    store.settings[el.getAttribute("data-set")] = el.value;
    save();
  }));
  document.querySelectorAll("[data-k]").forEach((el) => el.addEventListener("input", () => {
    const k = el.getAttribute("data-k");
    let value = el.value;
    if (k === "jobState") {
      value = String(value || "").toUpperCase().replace(/[^A-Za-z]/g, "").slice(0, 2);
      if (el.value !== value) el.value = value;
    }
    const extra = k === "pdfTitle" ? { pdfTitleCustom: true } : {};
    patch({ [k]: value, ...extra });
    const r = active();
    if (r && !r.pdfTitleCustom && (k === "date" || k === "projectNumber" || k === "printName")) {
      patch({ pdfTitle: autoTitle(r) });
    }
    if (k === "projectNumber") { applySavedLocation(); applySavedJobName(); }
    if (k === "jobName" || k === "projectNumber") { rememberJobName(active()); save(); }
    if ((k === "jobCity" || k === "jobState" || k === "date") && r) {
      if (r.wx && r.wx.placeKey !== placeKey(r)) {
        r.wx = null;
        save();
      }
      wxError = "";
      wxFailAt = 0;
      wxFailKey = "";
      if (weatherDateOk(r.date) && String(r.jobCity || "").trim() && String(r.jobState || "").trim().length >= 2) scheduleWeather();
    }
    if (step === 6 && (k === "pdfTitle" || k === "printName")) queuePrepare();
  }));
  document.querySelectorAll("[data-caption]").forEach((el) => el.addEventListener("input", () => {
    const id = el.getAttribute("data-caption");
    const r = active();
    r.photos = r.photos.map((p) => p.id === id ? { ...p, caption: el.value } : p);
    patch({});
  }));
  document.querySelectorAll("[data-row]").forEach((el) => el.addEventListener("input", () => {
    const key = el.getAttribute("data-row");
    const id = el.getAttribute("data-id");
    const f = el.getAttribute("data-f");
    const r = active();
    r[key] = r[key].map((row) => row.id === id ? { ...row, [f]: el.value } : row);
    if (key === "summaryLines") syncSummary(r);
    patch({});
  }));
  document.querySelectorAll('[data-row="summaryLines"]').forEach((el) => el.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const r = active();
    const id = el.getAttribute("data-id");
    const idx = r.summaryLines.findIndex((l) => l.id === id);
    const fresh = emptyRow.line();
    r.summaryLines.splice(idx + 1, 0, fresh);
    save();
    render();
    const next = document.querySelector('[data-row="summaryLines"][data-id="' + fresh.id + '"]');
    if (next) next.focus();
  }));
  const setLayout = (change) => {
    const r = active();
    if (!r) return;
    const L = Object.assign({}, layoutOf(r), change);
    store.settings.lastLayout = L;
    patch({ layout: L });
    render();
  };
  document.querySelectorAll("[data-lsize]").forEach((b) => b.addEventListener("click", () => {
    const v = b.getAttribute("data-lsize");
    setLayout({ size: v === "auto" ? "auto" : Number(v) });
  }));
  document.querySelectorAll("[data-lppp]").forEach((b) => b.addEventListener("click", () => {
    const r = active();
    if (!r) return;
    const v = Number(b.getAttribute("data-lppp"));
    r.photos.forEach((p) => { p.group = ""; });
    photoSel = new Set();
    setLayout({ ppp: v === 2 || v === 4 ? v : 1 });
  }));
  document.querySelectorAll("[data-psel]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-psel");
    if (photoSel.has(id)) photoSel.delete(id); else photoSel.add(id);
    render();
  }));
  document.querySelectorAll("[data-pact]").forEach((b) => b.addEventListener("click", () => photoAction(b.getAttribute("data-pact"))));
  document.querySelectorAll("[data-jhacam]").forEach((b) => b.addEventListener("click", () => {
    const el = document.querySelector('[data-jhafile="' + b.getAttribute("data-jhacam") + '"]');
    if (el) el.click();
  }));
  document.querySelectorAll("[data-jhalib]").forEach((b) => b.addEventListener("click", () => {
    const el = document.querySelector('[data-jhafilelib="' + b.getAttribute("data-jhalib") + '"]');
    if (el) el.click();
  }));
  document.querySelectorAll("[data-jhafile],[data-jhafilelib]").forEach((el) => el.addEventListener("change", () => {
    const slot = el.getAttribute("data-jhafile") || el.getAttribute("data-jhafilelib");
    const file = el.files && el.files[0];
    el.value = "";
    if (file) onJhaFile(slot, file);
  }));
  document.querySelectorAll("[data-jhacrop]").forEach((b) => b.addEventListener("click", () => {
    const r = active();
    const k = b.getAttribute("data-jhacrop");
    const cur = r && r.jha && r.jha[k];
    if (cur && cur.origId) openCrop(k, cur.origId, cur.corners, cur.enhance, false);
  }));
  document.querySelectorAll("[data-jharm]").forEach((b) => b.addEventListener("click", async () => {
    const r = active();
    const k = b.getAttribute("data-jharm");
    const cur = r && r.jha && r.jha[k];
    if (cur) { await deletePhoto(cur.id); if (cur.origId) await deletePhoto(cur.origId); thumbUrls.delete(cur.id); }
    const jha = Object.assign({}, r.jha);
    jha[k] = null;
    patch({ jha: jha });
    render();
  }));
  document.querySelectorAll("[data-photoskip]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-photoskip");
    const r = active();
    r.photos = r.photos.map((p) => p.id === id ? { ...p, skip: !p.skip } : p);
    patch({});
    render();
  }));
  document.querySelectorAll("[data-subrow]").forEach((el) => el.addEventListener("input", () => {
    const r = active();
    const sub = r.subcontractors.find((x) => x.id === el.getAttribute("data-subrow"));
    if (!sub) return;
    const id = el.getAttribute("data-id");
    const f = el.getAttribute("data-f");
    sub.crew = sub.crew.map((row) => row.id === id ? { ...row, [f]: el.value } : row);
    patch({});
  }));
  document.querySelectorAll("[data-subkind]").forEach((b) => b.addEventListener("click", () => {
    const parts = b.getAttribute("data-subkind").split("|");
    const r = active();
    const sub = r.subcontractors.find((x) => x.id === parts[0]);
    if (!sub) return;
    const kind = b.getAttribute("data-v") === "equip" ? "equip" : "crew";
    sub.crew = sub.crew.map((row) => row.id === parts[1] ? { ...row, kind: kind } : row);
    save();
    render();
  }));
  document.querySelectorAll("[data-subadd]").forEach((b) => b.addEventListener("click", () => {
    const r = active();
    const sub = r.subcontractors.find((x) => x.id === b.getAttribute("data-subadd"));
    if (!sub) return;
    const fresh = emptyRow.subcrew();
    sub.crew = sub.crew.concat([fresh]);
    save();
    render();
    const el = document.querySelector('[data-subrow="' + sub.id + '"][data-id="' + fresh.id + '"][data-f="className"]');
    if (el) el.focus();
  }));
  document.querySelectorAll("[data-subrm]").forEach((b) => b.addEventListener("click", () => {
    const parts = b.getAttribute("data-subrm").split("|");
    const r = active();
    const sub = r.subcontractors.find((x) => x.id === parts[0]);
    if (!sub) return;
    sub.crew = sub.crew.length <= 1 ? [emptyRow.subcrew()] : sub.crew.filter((row) => row.id !== parts[1]);
    save();
    render();
  }));
  document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
    const key = b.getAttribute("data-add");
    const r = active();
    const maker = key === "manpower" ? emptyRow.manpower : key === "subcontractors" ? emptyRow.sub : key === "summaryLines" ? emptyRow.line : key === "consumed" ? emptyRow.consumed : emptyRow.received;
    r[key] = r[key].concat([maker()]);
    save();
    render();
    if (key === "summaryLines") {
      const inputs = document.querySelectorAll('[data-row="summaryLines"]');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    }
    if (key === "manpower") {
      const inputs = document.querySelectorAll('[data-row="manpower"][data-f="className"]');
      const last = inputs[inputs.length - 1];
      if (last) last.focus();
    }
  }));
  document.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
    const key = b.getAttribute("data-rm");
    const id = b.getAttribute("data-id");
    const r = active();
    const blank = key === "manpower" ? emptyRow.manpower : key === "subcontractors" ? emptyRow.sub : key === "summaryLines" ? emptyRow.line : key === "consumed" ? emptyRow.consumed : emptyRow.received;
    r[key] = r[key].length <= 1 ? r[key].map((row) => row.id === id ? blank() : row) : r[key].filter((row) => row.id !== id);
    if (key === "summaryLines") syncSummary(r);
    save();
    render();
  }));
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => addPreset(b.getAttribute("data-preset"), b.getAttribute("data-kind"))));
  document.querySelectorAll("[data-kindrow]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-kindrow");
    const kind = b.getAttribute("data-v") === "equip" ? "equip" : "crew";
    const r = active();
    r.manpower = r.manpower.map((row) => row.id === id ? { ...row, kind: kind } : row);
    save();
    render();
  }));
  document.querySelectorAll("[data-proj]").forEach((b) => b.addEventListener("click", () => {
    patch({ projectNumber: b.getAttribute("data-proj") });
    const r = active();
    if (r && !r.pdfTitleCustom) patch({ pdfTitle: autoTitle(r) });
    applySavedLocation();
    const savedName = (store.settings.projectNames || {})[String(r.projectNumber || "").trim()];
    if (savedName) patch({ jobName: savedName });
    render();
  }));
  document.querySelectorAll("[data-yn]").forEach((b) => b.addEventListener("click", () => {
    patch({ [b.getAttribute("data-yn")]: b.getAttribute("data-v") });
    render();
  }));
  document.querySelectorAll("[data-wxm]").forEach((b) => b.addEventListener("click", () => {
    const i = Number(b.getAttribute("data-wxm"));
    const icon = b.getAttribute("data-icon");
    const r = active();
    if (!r) return;
    const m = normManual(r.wxManual);
    wxManualOpen = true;
    m[i].icon = m[i].icon === icon ? "" : icon;
    patch({ wxManual: m });
    render();
  }));
  document.querySelectorAll("[data-wxmt]").forEach((el) => el.addEventListener("input", () => {
    const i = Number(el.getAttribute("data-wxmt"));
    const f = el.getAttribute("data-f");
    const r = active();
    if (!r) return;
    const m = normManual(r.wxManual);
    wxManualOpen = true;
    m[i][f] = f === "tempF" ? String(el.value || "").replace(/[^0-9-]/g, "").slice(0, 4) : el.value;
    if (f === "tempF" && el.value !== m[i][f]) el.value = m[i][f];
    patch({ wxManual: m });
  }));
  document.querySelectorAll("[data-wxmt]").forEach((el) => el.addEventListener("blur", () => {
    setTimeout(() => { const a = document.activeElement; if (!a || !a.getAttribute || a.getAttribute("data-wxmt") == null) render(); }, 0);
  }));
  document.querySelectorAll("[data-wx]").forEach((b) => b.addEventListener("click", () => {
    const name = b.getAttribute("data-wx");
    const r = active();
    const cur = Array.isArray(r.weather) ? r.weather.slice() : [];
    const idx = cur.indexOf(name);
    if (idx >= 0) cur.splice(idx, 1);
    else cur.push(name);
    patch({ weather: WEATHER.filter((w) => cur.indexOf(w) >= 0) });
    render();
  }));
  document.querySelectorAll("[data-step]").forEach((b) => b.addEventListener("click", () => {
    const target = Number(b.getAttribute("data-step"));
    if (!Number.isFinite(target) || target === step) return;
    if (target > 0 && !jobOk()) return;
    step = target;
    render();
  }));
  document.querySelectorAll("[data-rmphoto]").forEach((b) => b.addEventListener("click", () => {
    const id = b.getAttribute("data-rmphoto");
    const r = active();
    r.photos = r.photos.filter((p) => p.id !== id);
    const url = thumbUrls.get(id);
    if (url) {
      URL.revokeObjectURL(url);
      thumbUrls.delete(id);
    }
    deletePhoto(id);
    patch({ photos: r.photos });
    render();
  }));
  if (step === 6 && screen === "wizard") setupSig();
  const cam = document.getElementById("photoFile");
  const lib = document.getElementById("libraryFile");
  if (cam) cam.addEventListener("change", onPhoto);
  if (lib) lib.addEventListener("change", onPhoto);
}

function onAct(e) {
  const act = e.currentTarget.getAttribute("data-act");
  if (act === "start") start(false, false);
  if (act === "new") start(false, true);
  if (act === "fromlast") start(true, true);
  if (act === "home") { askSent = false; screen = "home"; activeId = null; step = 0; render(); }
  if (act === "back") { step = Math.max(0, step - 1); render(); }
  if (act === "next") {
    if (!canNext()) return;
    step += 1;
    render();
  }
  if (act === "other") addWriteIn();
  if (act === "photo") { const el = document.getElementById("photoFile"); if (el) el.click(); }
  if (act === "library") { const el = document.getElementById("libraryFile"); if (el) el.click(); }
  if (act === "clearsig") {
    patch({ signatureDataUrl: "" });
    setupSig(true);
    prepareSendFiles();
  }
  if (act === "pdf") downloadPdf();
  if (act === "preview") previewPdf();
  if (act === "send") sendReport();
  if (act === "sent-yes") markSent();
  if (act === "sent-no") { askSent = false; render(); }
  if (act === "jhatoggle") {
    const r = active();
    if (!r) return;
    patch({ jha: Object.assign({ front: null, back: null }, r.jha, { on: !(r.jha && r.jha.on) }) });
    render();
  }
  if (act === "wxrefresh") {
    const r = active();
    if (!r || !weatherDateOk(r.date)) return;
    if (!String(r.jobCity || "").trim() || String(r.jobState || "").trim().length < 2) {
      toast("Enter the job city and state.");
      return;
    }
    wxFailAt = 0;
    wxFailKey = "";
    wxError = "";
    fetchWeather(true);
  }
  if (act === "wxmanual") {
    wxManualOpen = !wxManualOpen;
    render();
  }
}

function jobOk() {
  const r = active();
  if (!r || !String(r.jobName || "").trim() || !String(r.projectNumber || "").trim() || !String(r.printName || "").trim()) {
    toast("Job name, job number, and your name are required.");
    return false;
  }
  return true;
}

function canNext() {
  const r = active();
  if (step === 0 && !jobOk()) return false;
  if (step === 1 && !String(r.summary || "").trim()) {
    toast("Add a short summary of the work.");
    return false;
  }
  return true;
}

function start(fromLast, forceNew) {
  const items = list();
  const today = todayISO();
  if (!fromLast && !forceNew) {
    const existing = items.find((r) => r.status === "draft" && r.date === today);
    if (existing) { openReport(existing.id); return; }
  }
  const r = blankReport(store.settings);
  if (fromLast) {
    const last = items[0];
    if (last) {
      r.projectNumber = last.projectNumber;
      r.jobName = last.jobName || (store.settings.projectNames || {})[String(last.projectNumber || "").trim()] || "";
      r.printName = last.printName || store.settings.defaultName;
      r.recipientEmail = last.recipientEmail || store.settings.defaultEmail;
      const proj = String(last.projectNumber || "").trim();
      const loc = (store.settings.projectLocations || {})[proj];
      if (loc && (loc.city || loc.state)) {
        r.jobCity = loc.city || "";
        r.jobState = String(loc.state || "").toUpperCase();
      } else {
        r.jobCity = last.jobCity || "";
        r.jobState = String(last.jobState || "").toUpperCase();
      }
      r.wx = null;
      r.manpower = last.manpower.length
        ? last.manpower.map((row) => ({ ...emptyRow.manpower(), className: row.className, qty: row.qty, kind: row.kind === "equip" ? "equip" : "crew" }))
        : [emptyRow.manpower()];
    }
  }
  r.pdfTitle = autoTitle(r);
  store.reports[r.id] = r;
  store.order.unshift(r.id);
  save();
  openReport(r.id);
}

function openReport(id) {
  activeId = id;
  screen = "wizard";
  step = 0;
  askSent = false;
  photoSel = new Set();
  wxManualOpen = false;
  wxError = "";
  render();
}

async function removeReport(id) {
  const r = store.reports[id];
  if (r) { const ids = jhaBlobIds(r); for (let j = 0; j < ids.length; j += 1) await deletePhoto(ids[j]); }
  if (r && Array.isArray(r.photos)) {
    for (let i = 0; i < r.photos.length; i += 1) {
      const pid = r.photos[i].id;
      await deletePhoto(pid);
      const url = thumbUrls.get(pid);
      if (url) {
        URL.revokeObjectURL(url);
        thumbUrls.delete(pid);
      }
    }
  }
  delete store.reports[id];
  store.order = store.order.filter((x) => x !== id);
  save();
  render();
}

function addPreset(name, kind) {
  const r = active();
  if (!r) return;
  const useKind = kind === "equip" ? "equip" : (kind === "crew" ? "crew" : inferKind(name));
  const blank = r.manpower.find((row) => !String(row.className || "").trim());
  if (blank) {
    blank.className = name;
    blank.kind = useKind;
  } else r.manpower.push({ ...emptyRow.manpower(), className: name, kind: useKind });
  save();
  render();
}
function addWriteIn() {
  const r = active();
  if (!r.manpower.find((row) => !String(row.className || "").trim())) r.manpower.push(emptyRow.manpower());
  save();
  render();
  const inputs = document.querySelectorAll('[data-row="manpower"][data-f="className"]');
  let empty = null;
  for (let i = 0; i < inputs.length; i += 1) {
    if (!String(inputs[i].value || "").trim()) empty = inputs[i];
  }
  const target = empty || inputs[inputs.length - 1];
  if (target) target.focus();
}

const JHA_SLOTS = [["front", "Front: safety information"], ["back", "Back: crew sign in / sign out"]];
let photoSel = new Set();
let cropState = null;

function jhaBlobIds(r) {
  const out = [];
  const j = r && r.jha;
  if (!j) return out;
  ["front", "back"].forEach((k) => { if (j[k]) { if (j[k].id) out.push(j[k].id); if (j[k].origId) out.push(j[k].origId); } });
  return out;
}

function jhaPagesOf(r) {
  const j = r && r.jha;
  if (!j || !j.on) return [];
  return JHA_SLOTS.filter((sl) => j[sl[0]] && j[sl[0]].id).map((sl) => ({ id: j[sl[0]].id, label: sl[1] }));
}

// Which photos share a PDF page. Photos with the same `group` share a page (max 4).
// With no custom groups, the "per page" preset decides.
function photoPages(r) {
  const inc = (r.photos || []).filter((p) => !p.skip);
  const L = layoutOf(r);
  if (!inc.some((p) => p.group) && L.ppp > 1) {
    const out = [];
    for (let i = 0; i < inc.length; i += L.ppp) out.push(inc.slice(i, i + L.ppp));
    return out;
  }
  const pages = [];
  const open = new Map();
  inc.forEach((p) => {
    if (p.group && open.has(p.group) && open.get(p.group).length < 4) { open.get(p.group).push(p); return; }
    const pg = [p];
    pages.push(pg);
    if (p.group) open.set(p.group, pg);
  });
  return pages;
}

// Turn whatever the preset shows into explicit groups, so custom edits keep the rest as-is.
function materializeGroups(r) {
  photoPages(r).forEach((pg) => {
    const g = pg.length > 1 ? (pg[0].group || uid()) : "";
    pg.forEach((p) => { p.group = g; });
  });
  r.layout = Object.assign({}, layoutOf(r), { ppp: 1 });
}

function photoAction(act) {
  const r = active();
  if (!r) return;
  const ids = Array.from(photoSel);
  if (act === "clear") { photoSel = new Set(); render(); return; }
  if (!ids.length) return;
  materializeGroups(r);
  if (act === "combine") {
    if (ids.length < 2 || ids.length > 4) { toast("Pick 2 to 4 photos to put on one page."); return; }
    const g = uid();
    const chosen = r.photos.filter((p) => photoSel.has(p.id));
    const at = r.photos.findIndex((p) => photoSel.has(p.id));
    const rest = r.photos.filter((p) => !photoSel.has(p.id));
    chosen.forEach((p) => { p.group = g; p.skip = false; });
    const before = r.photos.slice(0, at).filter((p) => !photoSel.has(p.id)).length;
    r.photos = rest.slice(0, before).concat(chosen, rest.slice(before));
  }
  if (act === "separate") r.photos.forEach((p) => { if (photoSel.has(p.id)) p.group = ""; });
  if (act === "skip") {
    const allOff = r.photos.filter((p) => photoSel.has(p.id)).every((p) => p.skip);
    r.photos.forEach((p) => { if (photoSel.has(p.id)) { p.skip = !allOff; p.group = ""; } });
  }
  photoSel = new Set();
  patch({ photos: r.photos, layout: r.layout });
  render();
}

function photoPagesCard(r) {
  const photos = r.photos || [];
  if (!photos.length) return "";
  const L = layoutOf(r);
  const custom = photos.some((p) => p.group);
  const pages = photoPages(r);
  const off = photos.filter((p) => p.skip);
  const num = new Map();
  photos.forEach((p, i) => num.set(p.id, i + 1));
  const thumb = (p) => '<button type="button" class="pg-thumb' + (photoSel.has(p.id) ? " sel" : "") + (p.skip ? " off" : "") + '" data-psel="' + esc(p.id) + '">' +
    '<img data-photo="' + esc(p.id) + '" alt="Photo ' + num.get(p.id) + '" /><span>' + num.get(p.id) + "</span></button>";
  const presets = [[1, "1 per page"], [2, "2 per page"], [4, "4 per page"]];
  const n = photoSel.size;
  const selOff = n && photos.filter((p) => photoSel.has(p.id)).every((p) => p.skip);
  return "<label>Photo pages</label>" +
    '<div class="seg">' + presets.map((o) => '<button type="button" data-lppp="' + o[0] + '" class="' + (!custom && L.ppp === o[0] ? "on" : "") + '">' + o[1] + "</button>").join("") + "</div>" +
    '<p class="hint">Tap photos to select them, then put up to 4 on one page or split them back out.</p>' +
    '<div class="pg-list">' + pages.map((pg, i) => '<div class="pg"><div class="pg-h">Photo page ' + (i + 1) + (pg.length > 1 ? " · " + pg.length + " photos" : "") + '</div><div class="pg-row n' + pg.length + '">' + pg.map(thumb).join("") + "</div></div>").join("") +
    (off.length ? '<div class="pg pg-off"><div class="pg-h">Left off the report</div><div class="pg-row">' + off.map(thumb).join("") + "</div></div>" : "") + "</div>" +
    (n ? '<div class="pg-bar"><b>' + n + " selected</b>" +
      '<button type="button" class="btn btn-navy" data-pact="combine"' + (n < 2 || n > 4 ? " disabled" : "") + ">Put on one page</button>" +
      '<button type="button" class="btn btn-outline" data-pact="separate">Separate pages</button>' +
      '<button type="button" class="btn btn-ghost" data-pact="skip">' + (selOff ? "Add back to report" : "Leave off report") + "</button>" +
      '<button type="button" class="btn btn-ghost" data-pact="clear">Cancel</button></div><div class="pg-spacer"></div>' : "");
}

function jhaCard(r) {
  const j = r.jha || { on: false };
  let body = '<button type="button" class="check-row' + (j.on ? " on" : "") + '" data-act="jhatoggle"><span class="box">' + (j.on ? "✓" : "") + "</span>Add the JHA briefing to this report</button>";
  if (j.purged && !j.front && !j.back) body += '<p class="hint">JHA photos removed from phone after 14 days (sent copy is on file).</p>';
  if (j.on) {
    body += '<p class="hint">Two pages go between the report and the photos. Take a photo of each side, then drag the corners to the edges of the paper to cut off the background.</p>' +
      JHA_SLOTS.map((sl) => {
        const k = sl[0];
        const has = j[k] && j[k].id;
        return '<div class="jha-slot"><div class="jha-h">' + sl[1] + "</div>" +
          (has ? '<img class="jha-thumb" data-photo="' + esc(j[k].id) + '" alt="' + esc(sl[1]) + '" />' +
            '<div class="jha-btns"><button type="button" class="btn btn-outline" data-jhacrop="' + k + '">Adjust crop</button>' +
            '<button type="button" class="btn btn-ghost" data-jhacam="' + k + '">Retake</button>' +
            '<button type="button" class="btn btn-danger" data-jharm="' + k + '">Remove</button></div>'
            : '<div class="jha-btns"><button type="button" class="btn btn-navy" data-jhacam="' + k + '">Take photo</button>' +
            '<button type="button" class="btn btn-outline" data-jhalib="' + k + '">From library</button></div>') +
          '<input type="file" accept="image/*" capture="environment" data-jhafile="' + k + '" hidden />' +
          '<input type="file" accept="image/*" data-jhafilelib="' + k + '" hidden />' +
          "</div>";
      }).join("");
  }
  return '<div class="card"><h2>JHA briefing</h2>' + body + "</div>";
}

function loadImageFromBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => resolve({ img: img, url: url });
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image")); };
    img.src = url;
  });
}

function resizeToBlob(source, maxEdge, quality) {
  return new Promise((resolve, reject) => {
    const w0 = source.naturalWidth || source.width;
    const h0 = source.naturalHeight || source.height;
    const sc = Math.min(1, maxEdge / Math.max(w0, h0));
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(w0 * sc));
    c.height = Math.max(1, Math.round(h0 * sc));
    c.getContext("2d").drawImage(source, 0, 0, c.width, c.height);
    c.toBlob((b) => (b ? resolve(b) : reject(new Error("blob"))), "image/jpeg", quality);
  });
}

async function onJhaFile(slot, file) {
  const r = active();
  if (!r || !file) return;
  try {
    const loaded = await loadImageFromBlob(file);
    const orig = await resizeToBlob(loaded.img, 2400, 0.85);
    URL.revokeObjectURL(loaded.url);
    const origId = "jo-" + uid();
    await putPhoto(origId, orig);
    openCrop(slot, origId, null, true, true);
  } catch (e) {
    toast("Could not open that photo.");
  }
}

function defaultCorners(w, h) {
  const ix = w * 0.06;
  const iy = h * 0.06;
  return [{ x: ix, y: iy }, { x: w - ix, y: iy }, { x: w - ix, y: h - iy }, { x: ix, y: h - iy }];
}

async function openCrop(slot, origId, corners, enhance, fresh) {
  const blob = await getPhoto(origId);
  if (!blob) { toast("Original photo not found. Retake it."); return; }
  const loaded = await loadImageFromBlob(blob);
  const img = loaded.img;
  cropState = {
    slot: slot, origId: origId, img: img, url: loaded.url, fresh: !!fresh,
    corners: corners && corners.length === 4 ? corners.map((c) => ({ x: c.x, y: c.y })) : defaultCorners(img.naturalWidth, img.naturalHeight),
    enhance: enhance !== false, drag: -1, scale: 1,
  };
  showCrop();
}

function closeCrop() {
  const ov = document.getElementById("crop");
  if (ov) ov.remove();
  if (cropState && cropState.url) URL.revokeObjectURL(cropState.url);
  cropState = null;
  document.body.style.overflow = "";
}

function showCrop() {
  let ov = document.getElementById("crop");
  if (!ov) {
    ov = document.createElement("div");
    ov.id = "crop";
    document.body.appendChild(ov);
  }
  document.body.style.overflow = "hidden";
  const cs = cropState;
  const label = (JHA_SLOTS.find((sl) => sl[0] === cs.slot) || ["", "JHA"])[1];
  ov.innerHTML = '<div class="crop-top"><b>' + esc(label) + "</b><span>Drag the 4 corners to the edges of the paper.</span></div>" +
    '<div class="crop-stage"><canvas id="cropCanvas"></canvas></div>' +
    '<div class="crop-tools">' +
      '<button type="button" class="btn btn-ghost" data-crop="rotate">Rotate ↻</button>' +
      '<button type="button" class="btn btn-ghost" data-crop="reset">Reset corners</button>' +
      '<button type="button" class="btn ' + (cs.enhance ? "btn-navy" : "btn-ghost") + '" data-crop="enhance">' + (cs.enhance ? "✓ " : "") + "Scan look</button>" +
    "</div>" +
    '<div class="crop-nav"><button type="button" class="btn btn-ghost" data-crop="cancel">Cancel</button>' +
    '<button type="button" class="btn btn-gold" data-crop="save">Use this crop</button></div>';
  const canvas = document.getElementById("cropCanvas");
  const stage = ov.querySelector(".crop-stage");
  const maxW = Math.min(window.innerWidth, 520) - 24;
  const maxH = Math.max(200, window.innerHeight - 230);
  const iw = cs.img.naturalWidth;
  const ih = cs.img.naturalHeight;
  cs.scale = Math.min(maxW / iw, maxH / ih);
  const dpr = window.devicePixelRatio || 1;
  canvas.style.width = Math.round(iw * cs.scale) + "px";
  canvas.style.height = Math.round(ih * cs.scale) + "px";
  canvas.width = Math.round(iw * cs.scale * dpr);
  canvas.height = Math.round(ih * cs.scale * dpr);
  cs.dpr = dpr;
  drawCrop();
  const toImg = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return { x: (ev.clientX - rect.left) / cs.scale, y: (ev.clientY - rect.top) / cs.scale };
  };
  canvas.addEventListener("pointerdown", (ev) => {
    ev.preventDefault();
    const pt = toImg(ev);
    let best = -1;
    let bd = Infinity;
    cs.corners.forEach((c, i) => { const d = Math.hypot(c.x - pt.x, c.y - pt.y); if (d < bd) { bd = d; best = i; } });
    if (bd * cs.scale < 60) { cs.drag = best; canvas.setPointerCapture(ev.pointerId); }
  });
  canvas.addEventListener("pointermove", (ev) => {
    if (cs.drag < 0) return;
    ev.preventDefault();
    const pt = toImg(ev);
    cs.corners[cs.drag] = { x: Math.max(0, Math.min(iw, pt.x)), y: Math.max(0, Math.min(ih, pt.y)) };
    drawCrop();
  });
  const end = () => { cs.drag = -1; drawCrop(); };
  canvas.addEventListener("pointerup", end);
  canvas.addEventListener("pointercancel", end);
  ov.querySelectorAll("[data-crop]").forEach((b) => b.addEventListener("click", () => cropAct(b.getAttribute("data-crop"))));
  stage.style.touchAction = "none";
}

function drawCrop() {
  const cs = cropState;
  const canvas = document.getElementById("cropCanvas");
  if (!cs || !canvas) return;
  const ctx = canvas.getContext("2d");
  const k = cs.scale * cs.dpr;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(cs.img, 0, 0, canvas.width, canvas.height);
  ctx.setTransform(k, 0, 0, k, 0, 0);
  const c = cs.corners;
  ctx.beginPath();
  ctx.rect(0, 0, cs.img.naturalWidth, cs.img.naturalHeight);
  ctx.moveTo(c[0].x, c[0].y); ctx.lineTo(c[1].x, c[1].y); ctx.lineTo(c[2].x, c[2].y); ctx.lineTo(c[3].x, c[3].y); ctx.closePath();
  ctx.fillStyle = "rgba(7,21,37,0.6)";
  ctx.fill("evenodd");
  ctx.beginPath();
  ctx.moveTo(c[0].x, c[0].y); ctx.lineTo(c[1].x, c[1].y); ctx.lineTo(c[2].x, c[2].y); ctx.lineTo(c[3].x, c[3].y); ctx.closePath();
  ctx.lineWidth = 2.5 / k;
  ctx.strokeStyle = "#c49a36";
  ctx.stroke();
  c.forEach((pt, i) => {
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, (cs.drag === i ? 16 : 12) / k, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(196,154,54,0.35)";
    ctx.fill();
    ctx.lineWidth = 3 / k;
    ctx.strokeStyle = "#fff";
    ctx.stroke();
  });
}

async function cropAct(act) {
  const cs = cropState;
  if (!cs) return;
  if (act === "cancel") {
    if (cs.fresh) await deletePhoto(cs.origId);
    closeCrop();
    return;
  }
  if (act === "reset") { cs.corners = defaultCorners(cs.img.naturalWidth, cs.img.naturalHeight); drawCrop(); return; }
  if (act === "enhance") { cs.enhance = !cs.enhance; showCrop(); return; }
  if (act === "rotate") {
    const c = document.createElement("canvas");
    c.width = cs.img.naturalHeight;
    c.height = cs.img.naturalWidth;
    const ctx = c.getContext("2d");
    ctx.translate(c.width, 0);
    ctx.rotate(Math.PI / 2);
    ctx.drawImage(cs.img, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, "image/jpeg", 0.85));
    await putPhoto(cs.origId, blob);
    URL.revokeObjectURL(cs.url);
    const loaded = await loadImageFromBlob(blob);
    cs.img = loaded.img;
    cs.url = loaded.url;
    cs.corners = defaultCorners(cs.img.naturalWidth, cs.img.naturalHeight);
    showCrop();
    return;
  }
  if (act === "save") {
    const btn = document.querySelector('[data-crop="save"]');
    if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      const out = warpQuad(cs.img, cs.corners, 2000, cs.enhance);
      const blob = await new Promise((res) => out.toBlob(res, "image/jpeg", 0.8));
      const r = active();
      const prev = r.jha[cs.slot];
      const id = "jc-" + uid();
      await putPhoto(id, blob);
      if (prev && prev.id) { await deletePhoto(prev.id); thumbUrls.delete(prev.id); }
      if (prev && prev.origId && prev.origId !== cs.origId) await deletePhoto(prev.origId);
      const jha = Object.assign({}, r.jha, { on: true });
      jha[cs.slot] = { id: id, origId: cs.origId, corners: cs.corners.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) })), enhance: cs.enhance };
      patch({ jha: jha });
      closeCrop();
      render();
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Use this crop"; }
      toast("Could not save the crop.");
    }
  }
}

// Perspective-correct the chosen quad into a flat rectangle (like a document scanner).
function warpQuad(img, corners, maxEdge, enhance) {
  const p = corners;
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  let W = Math.max(dist(p[0], p[1]), dist(p[3], p[2]));
  let H = Math.max(dist(p[0], p[3]), dist(p[1], p[2]));
  // Angled photos make the near edge look wider. JHA sheets are letter paper, so snap
  // anything close to 8.5 x 11 to the true shape.
  const ratio = W / H;
  if (ratio > 0.6 && ratio < 1.0) W = H * (8.5 / 11);
  else if (ratio >= 1.0 && ratio < 1.65) H = W * (8.5 / 11);
  const sc = Math.min(1, maxEdge / Math.max(W, H));
  W = Math.max(1, Math.round(W * sc));
  H = Math.max(1, Math.round(H * sc));
  const src = document.createElement("canvas");
  src.width = img.naturalWidth;
  src.height = img.naturalHeight;
  const sctx = src.getContext("2d");
  sctx.drawImage(img, 0, 0);
  const sd = sctx.getImageData(0, 0, src.width, src.height).data;
  const sw = src.width;
  const sh = src.height;
  // Unit square -> quad (Heckbert)
  const x0 = p[0].x, y0 = p[0].y, x1 = p[1].x, y1 = p[1].y, x2 = p[2].x, y2 = p[2].y, x3 = p[3].x, y3 = p[3].y;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let a, b, c, d, e, f, g, h;
  if (Math.abs(dx3) < 1e-9 && Math.abs(dy3) < 1e-9) {
    a = x1 - x0; b = x2 - x1; c = x0; d = y1 - y0; e = y2 - y1; f = y0; g = 0; h = 0;
  } else {
    const den = dx1 * dy2 - dx2 * dy1;
    g = (dx3 * dy2 - dx2 * dy3) / den;
    h = (dx1 * dy3 - dx3 * dy1) / den;
    a = x1 - x0 + g * x1; b = x3 - x0 + h * x3; c = x0;
    d = y1 - y0 + g * y1; e = y3 - y0 + h * y3; f = y0;
  }
  const out = document.createElement("canvas");
  out.width = W;
  out.height = H;
  const octx = out.getContext("2d");
  const od = octx.createImageData(W, H);
  const o = od.data;
  for (let vy = 0; vy < H; vy += 1) {
    const v = (vy + 0.5) / H;
    for (let ux = 0; ux < W; ux += 1) {
      const u = (ux + 0.5) / W;
      const z = g * u + h * v + 1;
      let sx = (a * u + b * v + c) / z;
      let sy = (d * u + e * v + f) / z;
      sx = Math.max(0, Math.min(sw - 1.001, sx - 0.5));
      sy = Math.max(0, Math.min(sh - 1.001, sy - 0.5));
      const ix = sx | 0, iy = sy | 0, fx = sx - ix, fy = sy - iy;
      const i00 = (iy * sw + ix) * 4, i10 = i00 + 4, i01 = i00 + sw * 4, i11 = i01 + 4;
      const oi = (vy * W + ux) * 4;
      for (let ch = 0; ch < 3; ch += 1) {
        const top = sd[i00 + ch] + (sd[i10 + ch] - sd[i00 + ch]) * fx;
        const bot = sd[i01 + ch] + (sd[i11 + ch] - sd[i01 + ch]) * fx;
        o[oi + ch] = top + (bot - top) * fy;
      }
      o[oi + 3] = 255;
    }
  }
  if (enhance) {
    // "Scan look": even out the lighting (paper goes white even in shade), then darken the ink.
    const gray = new Float32Array(W * H);
    for (let i = 0, j = 0; j < gray.length; i += 4, j += 1) gray[j] = o[i] * 0.299 + o[i + 1] * 0.587 + o[i + 2] * 0.114;
    const B = Math.max(16, Math.round(Math.max(W, H) / 40));
    const bw = Math.ceil(W / B);
    const bh = Math.ceil(H / B);
    const bg = new Float32Array(bw * bh);
    for (let by = 0; by < bh; by += 1) {
      for (let bx = 0; bx < bw; bx += 1) {
        // A high percentile of each block = the paper brightness there (ink is dark).
        const vals = [];
        for (let yy = by * B; yy < Math.min(H, (by + 1) * B); yy += 2) {
          for (let xx = bx * B; xx < Math.min(W, (bx + 1) * B); xx += 2) vals.push(gray[yy * W + xx]);
        }
        vals.sort((m, n) => m - n);
        bg[by * bw + bx] = vals.length ? vals[Math.floor(vals.length * 0.9)] : 255;
      }
    }
    // Smooth the background map so block edges never show.
    const sm = new Float32Array(bg.length);
    for (let by = 0; by < bh; by += 1) {
      for (let bx = 0; bx < bw; bx += 1) {
        let sum = 0, cnt = 0;
        for (let dy = -1; dy <= 1; dy += 1) for (let dx = -1; dx <= 1; dx += 1) {
          const nx = bx + dx, ny = by + dy;
          if (nx >= 0 && ny >= 0 && nx < bw && ny < bh) { sum += bg[ny * bw + nx]; cnt += 1; }
        }
        sm[by * bw + bx] = Math.max(40, sum / cnt);
      }
    }
    for (let yy = 0; yy < H; yy += 1) {
      const fy = Math.min(bh - 1.001, Math.max(0, yy / B - 0.5));
      const y0i = fy | 0, ty = fy - y0i;
      for (let xx = 0; xx < W; xx += 1) {
        const fx = Math.min(bw - 1.001, Math.max(0, xx / B - 0.5));
        const x0i = fx | 0, tx = fx - x0i;
        const i00 = y0i * bw + x0i;
        const top = sm[i00] + (sm[i00 + 1] - sm[i00]) * tx;
        const bot = sm[i00 + bw] + (sm[i00 + bw + 1] - sm[i00 + bw]) * tx;
        const back = top + (bot - top) * ty;
        let t = gray[yy * W + xx] / back;
        t = (t - 0.45) / (0.9 - 0.45);
        t = t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(t, 1.6);
        const vv = Math.round(t * 255);
        const oi = (yy * W + xx) * 4;
        o[oi] = vv; o[oi + 1] = vv; o[oi + 2] = vv;
      }
    }
  }
  octx.putImageData(od, 0, 0);
  return out;
}

async function hydratePhotos() {
  const imgs = document.querySelectorAll("[data-photo]");
  for (let i = 0; i < imgs.length; i += 1) {
    const img = imgs[i];
    const id = img.getAttribute("data-photo");
    try {
      if (!thumbUrls.has(id)) {
        const blob = await getPhoto(id);
        if (!blob) continue;
        thumbUrls.set(id, URL.createObjectURL(blob));
      }
      if (img.isConnected) img.src = thumbUrls.get(id);
    } catch (e) {}
  }
}

async function onPhoto(e) {
  const files = Array.prototype.slice.call(e.target.files || []);
  e.target.value = "";
  if (!files.length) return;
  const r = active();
  for (let i = 0; i < files.length; i += 1) {
    const file = files[i];
    if (file.type && file.type.indexOf("image/") !== 0) continue;
    try {
      const blob = await compressImage(file);
      const id = uid();
      await putPhoto(id, blob);
      const takenAt = file.lastModified ? new Date(file.lastModified).toISOString() : new Date().toISOString();
      r.photos.push({ id: id, caption: "", takenAt: takenAt });
      r.photosPurged = false;
    } catch (err) {
      toast("Could not add that photo.");
    }
  }
  save();
  render();
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const maxEdge = 1600;
      let width = img.naturalWidth || img.width || 1;
      let height = img.naturalHeight || img.height || 1;
      const scale = Math.min(1, maxEdge / Math.max(width, height));
      width = Math.max(1, Math.round(width * scale));
      height = Math.max(1, Math.round(height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      canvas.toBlob((blob) => {
        if (!blob) reject(new Error("compress"));
        else resolve(blob);
      }, "image/jpeg", 0.8);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    img.src = url;
  });
}

function setupSig(clear) {
  const canvas = document.getElementById("sig");
  if (!canvas) return;
  teardownSig();
  const ctx = canvas.getContext("2d");
  const r = active();
  const w = canvas.clientWidth || 300;
  const h = canvas.clientHeight || 160;
  canvas.width = w * 2;
  canvas.height = h * 2;
  ctx.setTransform(2, 0, 0, 2, 0, 0);
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#142033";
  ctx.fillStyle = "#142033";
  if (r && r.signatureDataUrl && !clear) {
    const im = new Image();
    im.onload = () => ctx.drawImage(im, 0, 0, w, h);
    im.src = r.signatureDataUrl;
  }
  let drawing = false;
  let moved = false;
  let last = null;
  const pos = (ev) => {
    const rect = canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  };
  const start = (ev) => {
    ev.preventDefault();
    drawing = true;
    moved = false;
    last = pos(ev);
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
  };
  const move = (ev) => {
    if (!drawing) return;
    ev.preventDefault();
    const p = pos(ev);
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < 0.5) return;
    moved = true;
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last = p;
  };
  const end = () => {
    if (!drawing) return;
    drawing = false;
    if (!moved && last) {
      ctx.beginPath();
      ctx.arc(last.x, last.y, 1.3, 0, Math.PI * 2);
      ctx.fill();
    }
    patch({ signatureDataUrl: canvas.toDataURL("image/png") });
    prepareSendFiles();
  };
  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
  window.addEventListener("pointercancel", end);
  sigHandlers = { canvas: canvas, start: start, move: move, end: end };
}

function yn(v) { return v === "yes" ? "YES" : v === "no" ? "NO" : v === "na" ? "N/A" : "—"; }

function hoursOf(rows, kind) {
  let sum = 0;
  (rows || []).forEach((row) => {
    if ((row.kind === "equip" ? "equip" : "crew") !== kind) return;
    if (!String(row.className || "").trim()) return;
    const q = parseFloat(String(row.qty == null ? "" : row.qty).replace(/,/g, ""));
    const h = parseFloat(String(row.hours == null ? "" : row.hours).replace(/,/g, ""));
    if (Number.isFinite(q) && Number.isFinite(h)) sum += q * h;
  });
  return Math.round(sum * 100) / 100;
}

function manHours(rows) {
  return hoursOf(rows, "crew");
}

function reportText(r) {
  const rec = r.received.filter((x) => String(x.description || "").trim()).map((x) => "  • " + x.description + "  qty " + (x.qty || "—") + (x.uom ? " " + x.uom : "") + "  BOL " + yn(x.bolFiled)).join("\n");
  const con = r.consumed.filter((x) => String(x.description || "").trim()).map((x) => "  • " + x.description + "  qty " + (x.qty || "—") + (x.uom ? " " + x.uom : "")).join("\n");
  const named = r.manpower.filter((x) => String(x.className || "").trim());
  const ordered = named.filter((x) => x.kind !== "equip").concat(named.filter((x) => x.kind === "equip"));
  const crew = ordered.map((x) => "  • " + x.className + " (" + (x.kind === "equip" ? "Equip" : "Crew") + ")  qty " + (x.qty || "—") + "  hrs " + (x.hours || "—")).join("\n");
  const subs = subsOn(r) ? r.subcontractors.filter((x) => String(x.description || "").trim()).map((x) => {
    const rows = (x.crew || []).filter((c) => String(c.className || "").trim());
    return "  • " + x.description + (x.details ? " — " + x.details : "") +
      rows.map((c) => "\n      " + c.className + " (" + (c.kind === "equip" ? "Equip" : "Crew") + ")  qty " + (c.qty || "—") + "  hrs " + (c.hours || "—")).join("") +
      (rows.length ? "\n      Subcontractor man-hours: " + manHours(rows) : "");
  }).join("\n") : "";
  const weather = (r.weather || []).join(", ") || "—";
  const city = String(r.jobCity || "").trim();
  const st = String(r.jobState || "").trim().toUpperCase();
  const locLine = city ? "Job location: " + city + (st ? ", " + st : "") : "";
  let weatherLines;
  if (hasWeatherStrip(r)) {
    weatherLines = ["Weather — " + weatherSource(r)];
    effSlots(r).forEach((s) => {
      if (!s) return;
      if (s.status === "later") weatherLines.push("  " + s.t + ": Later today.");
      else if (s.status !== "ok") weatherLines.push("  " + s.t + ": No reading.");
      else weatherLines.push("  " + s.t + ": " + (s.tempF ? s.tempF + " F" : "—") + "  " + (s.cond || "—") + "  ·  Precip " + (s.precip || "—") + "  ·  Wind " + (s.wind || "—") + "  ·  Humidity " + (s.hum || "—"));
    });
    if ((r.weather || []).length || String(r.tempF || "").trim()) {
      weatherLines.push("Manual weather: " + weather);
      weatherLines.push("Temp F: " + (r.tempF || "—"));
    }
  } else {
    weatherLines = ["Weather: " + weather, "Temp F: " + (r.tempF || "—")];
  }
  const delayLine = r.delaysYN === "yes"
    ? "Yes" + (r.delayHours ? ", " + r.delayHours + " hrs lost" : "") + (r.delays ? " — " + r.delays : "")
    : "No";
  return [
    "STX CORPORATION — DAILY PROJECT SUMMARY",
    "Date: " + (formatLong(r.date) || r.date),
    "Job: " + (String(r.jobName || "").trim() || "—"),
    "Job #: " + (r.projectNumber || "—"),
    "Supervisor: " + (r.printName || "—"),
    locLine,
    ...weatherLines,
    "", "SUMMARY OF WORK PERFORMED", summaryItems(r).map((t, i) => "  " + (i + 1) + ". " + t).join("\n") || "—",
    "", "DELAYS / INTERRUPTIONS", delayLine,
    r.weatherImpact === "yes" ? "WEATHER IMPACT: " + (r.weatherImpactExplain || "Yes") : "",
    "", "RECEIVED AND ACCOUNTED MATERIALS", rec || "  (none)",
    "", "MATERIALS CONSUMED", con || "  (none)",
    "", "MANPOWER AND EQUIPMENT", crew || "  (none)",
    "Total man-hours (employees): " + manHours(ordered),
    ordered.some((x) => x.kind === "equip") ? "Equipment hours: " + hoursOf(ordered, "equip") : "",
    subsOn(r) ? "\nSUBCONTRACTORS\n" + (subs || "  (none)") : "",
    "", "Any incidents today: " + yn(r.incidents), r.incidents === "yes" ? r.incidentsExplain : "",
    "Any near misses today: " + yn(r.nearMiss), r.nearMiss === "yes" ? r.nearMissExplain : "",
    "Any equipment issues today: " + yn(r.equipmentIssues), r.equipmentIssues === "yes" ? r.equipmentIssuesExplain : "",
    ...CLOSEOUT.map((c) => c[1] + ": " + yn(r[c[0]])),
    jhaPagesOf(r).length ? "JHA briefing attached (" + jhaPagesOf(r).length + " page" + (jhaPagesOf(r).length > 1 ? "s" : "") + ")" : "",
    "", r.photosPurged
      ? "Photos removed from phone after 14 days (sent copy is on file)."
      : "Job photos: " + r.photos.length,
    "", "Print name: " + (r.printName || "—"),
  ].filter((x) => x !== "").join("\n");
}

function autoTitle(r) {
  const proj = String(r.projectNumber || "").trim() || "00000";
  const ymd = String(r.date || "").replace(/-/g, "").slice(2);
  const first = String(r.printName || "").trim().split(/\s+/)[0] || "Name";
  return proj + "- " + ymd + " " + first;
}

function fileName(r) {
  const raw = String(r.pdfTitle || autoTitle(r)).trim().replace(/\.pdf$/i, "");
  const safe = raw.replace(/[\\/:*?"<>|]/g, "-");
  return (safe || "report") + ".pdf";
}

let cachedLogo = null;
async function loadLogo() {
  if (cachedLogo !== null) return cachedLogo;
  try {
    const res = await fetch("./stx-logo-pdf-v2.jpg");
    const blob = await res.blob();
    cachedLogo = await blobToDataUrl(blob);
  } catch (e) {
    cachedLogo = "";
  }
  return cachedLogo;
}

// Shrink a stored photo to fit a byte cap. JPEG size grows roughly with pixel count, so one
// measured encode tells us how far to scale; a second pass corrects any miss.
const shrinkCache = new Map();
async function shrinkToCap(blob, cap, key) {
  if (!cap || blob.size <= cap) return blob;
  const ck = (key || "") + "|" + blob.size + "|" + cap;
  if (shrinkCache.has(ck)) return shrinkCache.get(ck);
  const loaded = await loadImageFromBlob(blob);
  const encode = (scale, q) => new Promise((res) => {
    const c = document.createElement("canvas");
    c.width = Math.max(1, Math.round(loaded.img.naturalWidth * scale));
    c.height = Math.max(1, Math.round(loaded.img.naturalHeight * scale));
    c.getContext("2d").drawImage(loaded.img, 0, 0, c.width, c.height);
    c.toBlob(res, "image/jpeg", q);
  });
  try {
    const q = 0.72;
    let first = await encode(1, q);
    let best = null;
    if (first && first.size <= cap) best = first;
    else {
      // Bracket the scale: hi = too big, lo = fits. Aim for 85-100% of the cap.
      let hi = 1;
      let lo = 0;
      let scale = Math.max(0.25, Math.sqrt(cap / first.size) * 0.95);
      for (let i = 0; i < 5; i += 1) {
        const out = await encode(scale, q);
        if (out && out.size <= cap) {
          lo = scale;
          best = out;
          if (out.size >= cap * 0.85) break;
          scale = (lo + hi) / 2;
        } else {
          hi = scale;
          scale = lo ? (lo + hi) / 2 : Math.max(0.2, scale * Math.sqrt(cap / out.size) * 0.9);
        }
      }
      if (!best) best = await encode(Math.max(0.2, lo || 0.3), 0.6);
    }
    const result = best && best.size < blob.size ? best : blob;
    if (shrinkCache.size > 60) shrinkCache.clear();
    shrinkCache.set(ck, result);
    return result;
  } finally {
    URL.revokeObjectURL(loaded.url);
  }
}

async function resolvePhoto(p, cap) {
  if (p && p.dataUrl) return p.dataUrl;
  if (!p || !p.id) return "";
  try {
    let blob = await getPhoto(p.id);
    if (!blob) return "";
    if (cap) blob = await shrinkToCap(blob, cap, p.id);
    return await blobToDataUrl(blob);
  } catch (e) {
    return "";
  }
}

function fitAddImage(doc, dataUrl, x, y, maxW, maxH) {
  const props = doc.getImageProperties(dataUrl);
  const iw = props.width || 1;
  const ih = props.height || 1;
  const scale = Math.min(maxW / iw, maxH / ih);
  const w = iw * scale;
  const h = ih * scale;
  let fmt = String(props.fileType || "JPEG").toUpperCase();
  if (fmt === "JPG") fmt = "JPEG";
  if (fmt !== "PNG" && fmt !== "JPEG") fmt = "JPEG";
  doc.addImage(dataUrl, fmt, x, y, w, h, undefined, "FAST");
  return { w: w, h: h };
}

function placeFitted(doc, dataUrl, boxX, boxY, boxW, boxH) {
  const props = doc.getImageProperties(dataUrl);
  const iw = props.width || 1;
  const ih = props.height || 1;
  const scale = Math.min(boxW / iw, boxH / ih, 1);
  const w = iw * scale;
  const h = ih * scale;
  const x = boxX + (boxW - w) / 2;
  const y = boxY;
  let fmt = String(props.fileType || "JPEG").toUpperCase();
  if (fmt === "JPG") fmt = "JPEG";
  if (fmt !== "PNG" && fmt !== "JPEG") fmt = "JPEG";
  doc.addImage(dataUrl, fmt, x, y, w, h, undefined, "FAST");
  return { w: w, h: h };
}

function drawCloud(doc, ix, iy, fill, stroke) {
  const paint = (color, grow) => {
    doc.setFillColor(color[0], color[1], color[2]);
    doc.circle(ix - 6, iy + 2, 6 + grow, "F");
    doc.circle(ix + 1, iy - 3, 8 + grow, "F");
    doc.circle(ix + 8, iy + 3, 5 + grow, "F");
    doc.roundedRect(ix - 11 - grow, iy + 2, 24 + grow * 2, 6 + grow, 3, 3, "F");
  };
  if (stroke) paint(stroke, 1.2);
  paint(fill, 0);
}

function drawSun(doc, ix, iy, rad, inner, outer) {
  doc.setFillColor(255, 214, 110);
  doc.circle(ix, iy, rad, "F");
  doc.setDrawColor(255, 214, 110);
  doc.setLineWidth(1.6);
  for (let a = 0; a < 360; a += 45) {
    const rads = a * Math.PI / 180;
    doc.line(ix + inner * Math.cos(rads), iy + inner * Math.sin(rads), ix + outer * Math.cos(rads), iy + outer * Math.sin(rads));
  }
}

function drawMoon(doc, ix, iy, rad, ox, oy, punch) {
  doc.setFillColor(167, 191, 220);
  doc.circle(ix, iy, rad, "F");
  doc.setFillColor(255, 255, 255);
  doc.circle(ix + ox, iy + oy, punch, "F");
}

function drawWxIcon(doc, kind, ix, iy) {
  if (kind === "sun") drawSun(doc, ix, iy, 7, 10, 13.5);
  else if (kind === "moon") drawMoon(doc, ix, iy, 10, 5.5, -4.5, 9);
  else if (kind === "partly-day") {
    drawSun(doc, ix - 7, iy - 7, 5, 7, 9.5);
    drawCloud(doc, ix, iy, [255, 255, 255], [170, 178, 188]);
  } else if (kind === "partly-night") {
    drawMoon(doc, ix - 7, iy - 7, 7, 4, -3, 6);
    drawCloud(doc, ix, iy, [255, 255, 255], [170, 178, 188]);
  } else if (kind === "rain" || kind === "storm" || kind === "snow") {
    drawCloud(doc, ix, iy, [154, 165, 177], null);
    if (kind === "storm") {
      doc.setFillColor(224, 168, 0);
      doc.triangle(ix + 1, iy + 4, ix - 4, iy + 13, ix + 1, iy + 12, "F");
      doc.triangle(ix + 0.5, iy + 11, ix - 2, iy + 20, ix + 6, iy + 11, "F");
    }
    doc.setDrawColor(91, 143, 217);
    doc.setLineWidth(1.3);
    if (kind === "snow") {
      doc.setFillColor(91, 143, 217);
      doc.circle(ix - 6, iy + 14, 1.3, "F");
      doc.circle(ix, iy + 16, 1.3, "F");
      doc.circle(ix + 6, iy + 14, 1.3, "F");
    } else if (kind === "storm") {
      doc.line(ix - 7, iy + 16, ix - 9, iy + 21);
      doc.line(ix + 7, iy + 16, ix + 5, iy + 21);
    } else {
      doc.line(ix - 6, iy + 12, ix - 8, iy + 18);
      doc.line(ix, iy + 12, ix - 2, iy + 18);
      doc.line(ix + 6, iy + 12, ix + 4, iy + 18);
    }
  } else if (kind === "fog") {
    doc.setFillColor(154, 165, 177);
    doc.roundedRect(ix - 12, iy - 8, 24, 3, 1.5, 1.5, "F");
    doc.roundedRect(ix - 12, iy - 1, 24, 3, 1.5, 1.5, "F");
    doc.roundedRect(ix - 12, iy + 6, 24, 3, 1.5, 1.5, "F");
  } else {
    drawCloud(doc, ix, iy, [154, 165, 177], null);
  }
  doc.setLineWidth(0.4);
}

async function buildPdfCore(r, opts) {
  opts = opts || {};
  const level = Math.max(0, Math.min(2, Number(opts.level) || 0));
  const D = PDF_DENSITY[level];
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const NAVY = [12, 35, 64];
  const INK = [20, 32, 51];
  const MUTED = [92, 101, 112];
  const LINE = [196, 188, 168];
  const HEAD = [232, 226, 212];
  const RED = [155, 28, 28];
  const pageW = 612;
  const pageH = 792;
  const margin = 40;
  const contentW = pageW - margin * 2;
  const contentBottom = pageH - 32;
  let y = 0;
  const logo = await loadLogo();

  function newPage() {
    doc.addPage();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text((String(r.jobName || "").trim() ? String(r.jobName).trim() + "  ·  " : "") + "Job # " + (r.projectNumber || "—") + "  ·  " + (formatLong(r.date) || r.date) + "  ·  continued", margin, 22);
    y = 34;
  }

  function paintBar(title, continued) {
    const label = String(title).toUpperCase() + (continued ? " (continued)" : "");
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.rect(margin, y, contentW, D.bar, "F");
    doc.setTextColor(255, 252, 245);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(label, margin + 6, y + D.bar - 4);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += D.bar;
  }

  function writeBody(text) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(D.font);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    const lines = doc.splitTextToSize(String(text || "—"), contentW - 12);
    lines.forEach((line) => {
      if (y + D.lh > contentBottom) newPage();
      doc.text(line, margin + 6, y + D.lh - 2);
      y += D.lh;
    });
    y += D.gap;
  }

  function openText(title, text) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(D.font);
    const lines = doc.splitTextToSize(String(text || "—"), contentW - 12);
    const follow = Math.min(2, Math.max(lines.length, 1)) * D.lh + 2;
    if (y + D.bar + follow > contentBottom) newPage();
    paintBar(title, false);
    writeBody(text);
  }

  function measureRow(cells, widths) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(D.font);
    const wrapped = cells.map((cell, i) => doc.splitTextToSize(String(cell == null ? "" : cell), widths[i] - 8));
    let lines = 1;
    wrapped.forEach((w) => { if (w.length > lines) lines = w.length; });
    return { wrapped: wrapped, h: Math.max(D.row, lines * D.lh + 3) };
  }

  function paintHead(headers, widths) {
    doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
    doc.rect(margin, y, contentW, D.head, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    let x = margin;
    headers.forEach((h, i) => {
      doc.text(String(h), x + 4, y + D.head - 4);
      x += widths[i];
    });
    y += D.head;
  }

  function paintRow(measured, widths) {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(D.font);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    let x = margin;
    widths.forEach((w, i) => {
      doc.rect(x, y, w, measured.h);
      doc.text(measured.wrapped[i], x + 4, y + D.lh);
      x += w;
    });
    y += measured.h;
  }

  function drawTable(title, headers, rows, widths, pre, tail) {
    tail = tail || 0;
    const preH = pre ? doc.splitTextToSize(String(pre), contentW - 12).length * D.lh + 4 : 0;
    if (!rows.length) {
      if (y + D.bar + preH + D.row + 2 > contentBottom) newPage();
      paintBar(title, false);
      if (pre) writeBody(pre);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(D.font);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.text("None", margin + 6, y + D.lh + 1);
      y += D.lh + 7;
      return;
    }
    const measured = rows.map((row) => measureRow(row, widths));
    const whole = D.bar + preH + D.head + measured.reduce((a, m) => a + m.h, 0) + tail;
    // Short tables (and their totals) stay on one page; long ones break between rows.
    if (whole <= 260 && y + whole > contentBottom) newPage();
    else if (y + D.bar + preH + D.head + measured[0].h + (rows.length === 1 ? tail : 0) > contentBottom) newPage();
    paintBar(title, false);
    if (pre) writeBody(pre);
    paintHead(headers, widths);
    rows.forEach((row, idx) => {
      const m = measured[idx];
      const need = m.h + (idx === rows.length - 1 ? tail : 0);
      if (y + need > contentBottom && y > 80) {
        newPage();
        paintBar(title, true);
        paintHead(headers, widths);
      }
      paintRow(m, widths);
    });
    y += D.gap;
  }

  doc.setFillColor(255, 252, 245);
  doc.rect(0, 0, pageW, 76, "F");
  if (logo) {
    try { fitAddImage(doc, logo, margin, 10, 250, 56); } catch (e) {}
  }
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("DAILY PROJECT SUMMARY", pageW - margin, 25, { align: "right" });
  const jobName = String(r.jobName || "").trim();
  if (jobName) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    let jn = jobName;
    while (jn.length > 4 && doc.getTextWidth(jn) > 290) jn = jn.slice(0, -1);
    if (jn !== jobName) jn = jn.trim() + "...";
    doc.text(jn, pageW - margin, 39, { align: "right" });
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(D.font);
  doc.text(formatLong(r.date) || r.date || "", pageW - margin, 53, { align: "right" });
  doc.text("Job # " + (r.projectNumber || "—"), pageW - margin, 65, { align: "right" });
  doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.rect(0, 76, pageW, 2, "F");
  doc.setFillColor(196, 154, 54);
  doc.rect(0, 78, pageW, 3, "F");

  y = 88;
  const hasWx = hasWeatherStrip(r);
  let info;
  if (hasWx) {
    const city = String(r.jobCity || "").trim();
    const st = String(r.jobState || "").trim().toUpperCase();
    const loc = city ? city + (st ? ", " + st : "") : "—";
    info = "Supervisor  " + (r.printName || "—") + "    ·    Job location  " + loc;
  } else {
    const weatherTxt = (Array.isArray(r.weather) ? r.weather : []).filter(Boolean).join(", ") || "—";
    const tempTxt = String(r.tempF || "").trim() ? String(r.tempF).trim() + "\u00B0F" : "—";
    info = "Supervisor  " + (r.printName || "—") + "    ·    Weather  " + weatherTxt + "    ·    Temp  " + tempTxt;
  }
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const infoLines = doc.splitTextToSize(info, contentW - 12);
  const infoH = infoLines.length * D.lh + 8;
  doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
  doc.rect(margin, y, contentW, infoH, "F");
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(infoLines, margin + 6, y + D.tot - 4);
  y += infoH + D.gap + 2;

  if (hasWx) {
    const W = D.wx;
    if (y + D.bar + W.h + 18 > contentBottom) newPage();
    const city = String(r.jobCity || "").trim();
    const st = String(r.jobState || "").trim().toUpperCase();
    const place = city ? city + (st ? ", " + st : "") : "";
    paintBar(place ? "Weather · " + place : "Weather", false);
    const boxTop = y;
    const boxH = W.h;
    const colW = contentW / 3;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.7);
    doc.rect(margin, boxTop, contentW, boxH, "FD");
    const slots = effSlots(r);
    for (let i = 0; i < 3; i += 1) {
      const slot = slots[i] || blankSlot(SLOT_TIMES[i].t, "miss", "No reading.");
      const x = margin + i * colW;
      const ix = x + 26;
      const iy = boxTop + W.iy;
      if (slot.status === "ok" && slot.icon) drawWxIcon(doc, slot.icon, ix, iy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(D.font);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(String(slot.t || ""), ix, boxTop + W.tl, { align: "center" });
      const tx = x + 48;
      const textW = colW - 56;
      if (slot.status !== "ok") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(D.font);
        doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
        const msg = slot.status === "later" ? "Later today." : "No reading.";
        doc.text(doc.splitTextToSize(msg, textW), tx, boxTop + 32);
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(W.tf);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        doc.text(slot.tempF ? slot.tempF + "\u00B0" : "—", tx, boxTop + W.temp);
        doc.setFontSize(8);
        doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
        let cond = String(slot.cond || "");
        const condLines = doc.splitTextToSize(cond, textW);
        if (condLines.length > 1) cond = String(condLines[0]).replace(/\s+\S*$/, "") + "...";
        doc.text(cond || "—", tx, boxTop + W.cond);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        const meta = slot.src === "manual"
          ? ["Wind  " + (slot.wind || "—"), "Entered on site"]
          : [
            "Precipitation  " + (slot.precip || "—"),
            "Wind  " + (slot.wind || "—"),
            "Humidity  " + (slot.hum || "—"),
          ];
        meta.forEach((line, mi) => doc.text(line, tx, boxTop + W.m0 + mi * W.ms));
      }
    }
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.7);
    doc.rect(margin, boxTop, contentW, boxH);
    doc.setLineWidth(0.4);
    doc.line(margin + colW, boxTop, margin + colW, boxTop + boxH);
    doc.line(margin + colW * 2, boxTop, margin + colW * 2, boxTop + boxH);
    y = boxTop + boxH + W.src;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    const src = weatherSource(r);
    const srcLines = doc.splitTextToSize(src, contentW - 12);
    srcLines.forEach((line) => {
      doc.text(line, margin + contentW / 2, y, { align: "center" });
      y += 9;
    });
    y += D.gap;
    doc.setLineWidth(0.4);
  }

  (function drawSummaryLines() {
    const items = summaryItems(r);
    const list = items.length ? items : ["—"];
    doc.setFont("helvetica", "normal");
    doc.setFontSize(D.font);
    const rows = list.map((t, i) => {
      const lines = doc.splitTextToSize(String(t), contentW - 30);
      return { n: items.length ? (i + 1) + "." : "", lines: lines, h: Math.max(D.sum, lines.length * D.lh + 4) };
    });
    const first = rows[0].h + (rows[1] ? rows[1].h : 0);
    if (y + D.bar + first > contentBottom) newPage();
    paintBar("Summary of work performed", false);
    rows.forEach((row) => {
      if (y + row.h > contentBottom) { newPage(); paintBar("Summary of work performed", true); }
      doc.setFont("helvetica", "bold");
      doc.setFontSize(D.font);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(row.n, margin + 6, y + D.lh);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.text(row.lines, margin + 24, y + D.lh);
      y += row.h;
      doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
      doc.setLineWidth(0.4);
      doc.line(margin, y, margin + contentW, y);
    });
    y += D.gap + 2;
  })();

  let delayText = "No";
  if (r.delaysYN === "yes") {
    const hrs = String(r.delayHours || "").trim();
    delayText = hrs ? "Yes, " + hrs + " hrs lost" : "Yes";
    const explain = String(r.delays || "").trim();
    if (explain) delayText += "\n" + explain;
  }
  openText("Delays", delayText);

  if (r.weatherImpact === "yes") {
    openText("Weather impact", String(r.weatherImpactExplain || "").trim() || "Yes");
  }

  const rec = (r.received || []).filter((x) => String(x.description || "").trim());
  drawTable(
    "Received and accounted materials",
    ["Description", "QTY", "UOM", "BOL filed"],
    rec.map((x) => [x.description, x.qty || "—", x.uom || "—", yn(x.bolFiled)]),
    [268, 72, 72, 120]
  );

  const con = (r.consumed || []).filter((x) => String(x.description || "").trim());
  drawTable(
    "Materials consumed",
    ["Description", "QTY", "UOM"],
    con.map((x) => [x.description, x.qty || "—", x.uom || "—"]),
    [360, 80, 92]
  );

  const named = (r.manpower || []).filter((x) => String(x.className || "").trim());
  const ordered = named.filter((x) => x.kind !== "equip").concat(named.filter((x) => x.kind === "equip"));
  const crewWidths = [272, 60, 100, 100];
  const crewHeads = ["Class / equipment", "Type", "QTY", "Hours"];
  const totalsH = (rows) => (rows.length ? (rows.some((x) => x.kind === "equip") ? D.tot * 2 + D.gap : D.tot + D.gap) : 0);
  drawTable(
    "Manpower and equipment",
    crewHeads,
    ordered.map((x) => [x.className, x.kind === "equip" ? "Equip" : "Crew", x.qty || "—", x.hours || "—"]),
    crewWidths,
    "",
    totalsH(ordered)
  );
  function drawTotals(title, rows, label) {
    const equipRows = rows.filter((x) => x.kind === "equip");
    const totalLines = equipRows.length ? 2 : 1;
    // (drawTable already reserved this space, so this only triggers on very long tables)
    if (y + totalLines * D.tot + D.gap > contentBottom) {
      newPage();
      paintBar(title, true);
      paintHead(crewHeads, crewWidths);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(D.font);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(label, margin + 6, y + D.tot - 4);
    doc.text(String(manHours(rows)), margin + contentW - 6, y + D.tot - 4, { align: "right" });
    y += D.tot;
    if (equipRows.length) {
      doc.setFont("helvetica", "normal");
      doc.text("Equipment hours", margin + 6, y + D.tot - 4);
      doc.text(String(hoursOf(rows, "equip")), margin + contentW - 6, y + D.tot - 4, { align: "right" });
      y += D.tot;
    }
    y += D.gap;
  }
  if (ordered.length) drawTotals("Manpower and equipment", ordered, "Total man-hours (employees)");

  if (subsOn(r)) {
    const subList = (r.subcontractors || []).filter((x) => String(x.description || "").trim() || (x.crew || []).some((c) => String(c.className || "").trim()));
    if (!subList.length) drawTable("Subcontractors", crewHeads, [], crewWidths);
    subList.forEach((sub) => {
      const title = "Subcontractor · " + (String(sub.description || "").trim() || "—");
      const named2 = (sub.crew || []).filter((x) => String(x.className || "").trim());
      const ord2 = named2.filter((x) => x.kind !== "equip").concat(named2.filter((x) => x.kind === "equip"));
      const pre = String(sub.details || "").trim() ? "Work performed: " + String(sub.details).trim() : "";
      drawTable(title, crewHeads, ord2.map((x) => [x.className, x.kind === "equip" ? "Equip" : "Crew", x.qty || "—", x.hours || "—"]), crewWidths, pre, totalsH(ord2));
      if (ord2.length) drawTotals(title, ord2, "Subcontractor man-hours");
    });
    // With subcontractors, Safety and closeout starts page 2. If the subs already
    // ran onto page 2, Safety simply follows them there.
    if (doc.getNumberOfPages() === 1) newPage();
  }

  const safety = [
    ["Incidents", r.incidents, "yes"],
    ["Near misses", r.nearMiss, "yes"],
    ["Equipment issues", r.equipmentIssues, "yes"],
  ].concat(CLOSEOUT.map((c) => [c[2], r[c[0]], "no"]));
  const notes = [];
  if (r.incidents === "yes" && String(r.incidentsExplain || "").trim()) notes.push("Incidents: " + String(r.incidentsExplain).trim());
  if (r.nearMiss === "yes" && String(r.nearMissExplain || "").trim()) notes.push("Near misses: " + String(r.nearMissExplain).trim());
  if (r.equipmentIssues === "yes" && String(r.equipmentIssuesExplain || "").trim()) notes.push("Equipment issues: " + String(r.equipmentIssuesExplain).trim());
  const rowH = D.safe;
  const gridRows = Math.ceil(safety.length / 2);
  const gridH = gridRows * rowH;
  const safetyFollow = gridH + (notes.length ? 22 : 0);
  if (y + D.bar + safetyFollow > contentBottom) newPage();
  paintBar("Safety and closeout", false);
  const gridTop = y;
  const colW = contentW / 2;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.setLineWidth(0.4);
  doc.rect(margin, gridTop, contentW, gridH);
  doc.line(margin + colW, gridTop, margin + colW, gridTop + gridH);
  for (let gr = 1; gr < gridRows; gr += 1) doc.line(margin, gridTop + rowH * gr, margin + contentW, gridTop + rowH * gr);
  safety.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * colW;
    const yy = gridTop + row * rowH;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(D.font);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(item[0], x + 6, yy + D.safe - 4.5);
    const value = yn(item[1]);
    const alert = item[2] && item[1] === item[2];
    doc.setFont("helvetica", "bold");
    if (alert) doc.setTextColor(RED[0], RED[1], RED[2]);
    else if (item[1] === "na") doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(value, x + colW - 8, yy + D.safe - 4.5, { align: "right" });
  });
  y = gridTop + gridH + D.gap + 2;
  notes.forEach((note) => writeBody(note));

  const blockH = D.sig;
  if (y + blockH > contentBottom) newPage();
  const top = y;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.setLineWidth(0.7);
  doc.line(margin, top + D.sl, margin + 200, top + D.sl);
  doc.line(margin + 240, top + D.sl, margin + contentW, top + D.sl);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(r.printName || " ", margin, top + D.sl - 6);
  if (r.signatureDataUrl) {
    try { doc.addImage(r.signatureDataUrl, "PNG", margin + 240, top + D.sl - 34 * D.ss - 2, 170 * D.ss, 34 * D.ss, undefined, "FAST"); } catch (e) {}
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text("PRINT NAME", margin, top + D.sl + 12);
  doc.text("SIGNATURE", margin + 240, top + D.sl + 12);
  y = top + blockH;

  if (r.photosPurged && !(r.photos || []).length) {
    const note = "Photos removed from phone after 14 days (sent copy is on file).";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(D.font);
    const noteLines = doc.splitTextToSize(note, contentW);
    if (y + noteLines.length * 12 + 4 > contentBottom) newPage();
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(noteLines, margin, y + 11);
    y += noteLines.length * 12 + 4;
  }

  const reportPages = doc.getNumberOfPages();
  const photos = [];
  const srcPhotos = opts.noPhotos ? [] : (r.photos || []).filter((p) => !p.skip);
  for (let i = 0; i < srcPhotos.length; i += 1) {
    const p = srcPhotos[i];
    const dataUrl = await resolvePhoto(p, opts.caps && opts.caps.get(p.id));
    if (!dataUrl) continue;
    photos.push({ id: p.id, caption: p.caption || "", takenAt: p.takenAt || "", dataUrl: dataUrl });
  }
  const photoBanner = (text) => {
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.rect(0, 0, pageW, 36, "F");
    doc.setTextColor(255, 252, 245);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(text, margin, 23);
  };
  const stamp = "Job # " + (r.projectNumber || "—") + "  ·  " + (formatLong(r.date) || r.date);
  // JHA briefing pages sit between the report and the job photos.
  let jhaCount = 0;
  if (!opts.noPhotos) {
    const jp = jhaPagesOf(r);
    for (let i = 0; i < jp.length; i += 1) {
      const dataUrl = await resolvePhoto({ id: jp[i].id }, opts.caps && opts.caps.get(jp[i].id));
      if (!dataUrl) continue;
      doc.addPage();
      jhaCount += 1;
      photoBanner("JHA briefing  ·  " + jp[i].label + "  ·  " + stamp);
      try { placeFitted(doc, dataUrl, margin, 50, contentW, pageH - 40 - 50); } catch (e) {}
    }
  }
  const byId = new Map(photos.map((p) => [p.id, p]));
  const groups = opts.noPhotos ? [] : photoPages(r).map((pg) => pg.map((p) => byId.get(p.id)).filter(Boolean)).filter((pg) => pg.length);
  const totalPhotos = groups.reduce((n, pg) => n + pg.length, 0);
  let shown = 0;
  const captionBlock = (p, x, py, w, capSize, timeSize, maxLines) => {
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(capSize);
    const capLines = doc.splitTextToSize(String(p.caption || "").trim() || "No description", w).slice(0, maxLines);
    doc.text(capLines, x, py);
    py += capLines.length * (capSize + 3);
    const when = formatTaken(p.takenAt);
    if (when) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(timeSize);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(when, x, py);
      py += timeSize + 2;
    }
    return py + 4;
  };
  groups.forEach((pg) => {
    doc.addPage();
    const first = shown + 1;
    shown += pg.length;
    photoBanner((pg.length === 1 ? "Photo " + first : "Photos " + first + "–" + shown) + " of " + totalPhotos + "  ·  " + stamp);
    const top0 = 46;
    if (pg.length === 1) {
      const py = captionBlock(pg[0], margin, top0 + 18, contentW, 14, 10, 3);
      try { placeFitted(doc, pg[0].dataUrl, margin, py + 4, contentW, pageH - 40 - py - 4); } catch (e) {}
    } else if (pg.length === 2) {
      const half = (pageH - 40 - top0) / 2;
      pg.forEach((p, k) => {
        const py = captionBlock(p, margin, top0 + k * half + 14, contentW, 11, 9, 2);
        const boxH = top0 + (k + 1) * half - py - 8;
        if (boxH > 40) { try { placeFitted(doc, p.dataUrl, margin, py, contentW, boxH); } catch (e) {} }
      });
    } else {
      const gap = 14;
      const cellW = (contentW - gap) / 2;
      const cellH = (pageH - 40 - top0) / 2;
      pg.forEach((p, k) => {
        const row = Math.floor(k / 2);
        let x = margin + (k % 2) * (cellW + gap);
        if (pg.length === 3 && k === 2) x = margin + (contentW - cellW) / 2;
        const py = captionBlock(p, x, top0 + row * cellH + 14, cellW, 9.5, 8, 2);
        const boxH = top0 + (row + 1) * cellH - py - 8;
        if (boxH > 40) { try { placeFitted(doc, p.dataUrl, x, py, cellW, boxH); } catch (e) {} }
      });
    }
  });
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text("STX Corporation — Daily Project Summary", margin, pageH - 22);
    doc.text("Page " + i + " of " + pages, pageW - margin, pageH - 22, { align: "right" });
  }
  return { blob: doc.output("blob"), reportPages: reportPages, totalPages: pages, jhaPages: jhaCount, level: level };
}

function layoutOf(r) {
  const L = (r && r.layout) || {};
  return { size: (L.size === 0 || L.size === 1 || L.size === 2) ? L.size : "auto", ppp: L.ppp === 2 || L.ppp === 4 ? L.ppp : 1 };
}

// Auto-fit: try Normal, then Compact, then Tight text until the report (not the
// photo pages) fits on one page. Photos are left out of the trial runs for speed.
const PDF_LIMIT = 2000000; // reports must stay at or under 2 MB

// Byte caps per image so photos + JHA fit the 2 MB limit. Images that already fit are left alone;
// if the total is too big, every image is scaled back by the same share.
async function imageCaps(r, target) {
  const ids = (r.photos || []).filter((p) => !p.skip).map((p) => p.id).concat(jhaPagesOf(r).map((x) => x.id));
  const sizes = new Map();
  let total = 0;
  for (const id of ids) {
    let size = 0;
    try { const b = await getPhoto(id); size = b ? b.size : 0; } catch (e) { size = 0; }
    sizes.set(id, size);
    total += size;
  }
  const avail = target - 160000; // logo, signature, text and PDF overhead
  if (total <= avail) return null;
  const share = Math.max(0.05, avail / total);
  const caps = new Map();
  sizes.forEach((size, id) => caps.set(id, Math.max(45000, Math.floor(size * share))));
  return caps;
}

async function buildWithinLimit(r, level, ppp) {
  let target = PDF_LIMIT;
  let res = null;
  for (let tries = 0; tries < 4; tries += 1) {
    const caps = await imageCaps(r, target);
    res = await buildPdfCore(r, { level: level, ppp: ppp, caps: caps });
    res.bytes = res.blob.size;
    if (res.bytes <= PDF_LIMIT) return res;
    target = Math.floor(target * (PDF_LIMIT / res.bytes) * 0.95);
  }
  return res;
}

async function buildReportPdf(r) {
  const L = layoutOf(r);
  if (L.size !== "auto") return buildWithinLimit(r, L.size, L.ppp);
  let best = null;
  for (let lv = 0; lv <= 2; lv += 1) {
    const trial = await buildPdfCore(r, { level: lv, noPhotos: true });
    if (!best || trial.reportPages < best.reportPages) best = trial;
    if (trial.reportPages === 1) break;
  }
  return buildWithinLimit(r, best.level, L.ppp);
}

async function buildPdf(r) {
  return (await buildReportPdf(r)).blob;
}

function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

async function downloadPdf() {
  const r = active();
  if (!r) return;
  if (!window.jspdf) { toast("PDF library still loading — try again."); return; }
  const pack = preparedFiles;
  const blob = packMatches(pack, r) ? pack.blob : await buildPdf(r);
  downloadBlob(blob, fileName(r));
  toast("PDF saved.");
}

async function previewPdf() {
  const r = active();
  if (!r) return;
  if (!String(r.printName || "").trim() || !r.signatureDataUrl) {
    toast("Print name and signature are required.");
    if (step !== 6) { step = 6; render(); }
    return;
  }
  if (!window.jspdf) { toast("PDF library still loading — try again."); return; }
  if (r.jha && r.jha.on && jhaPagesOf(r).length < 2) toast("JHA is checked but a page photo is missing.");
  // Copy the office email first, while the tap still counts as a user action.
  const email = String(r.recipientEmail || DEFAULT_EMAIL).trim();
  let copyP = null;
  try { if (navigator.clipboard && navigator.clipboard.writeText) copyP = navigator.clipboard.writeText(email); } catch (e) { copyP = null; }
  const w = window.open("", "_blank");
  try {
    const pack = preparedFiles;
    const blob = packMatches(pack, r) ? pack.blob : (await buildReportPdf(r)).blob;
    rememberSettings(r);
    save();
    const file = new File([blob], fileName(r), { type: "application/pdf" });
    const url = URL.createObjectURL(file);
    if (w) w.location = url;
    else {
      downloadBlob(blob, fileName(r));
      toast("Preview blocked. PDF downloaded instead.");
    }
    if (copyP) copyP.then(() => toast("Office email copied. Paste it in To when you share."), () => {});
  } catch (err) {
    if (w && w.close) w.close();
    toast("Could not build the PDF.");
  }
}

function layoutKey(r) {
  const L = layoutOf(r);
  return L.size + "|" + L.ppp + "|" + (r.photos || []).map((p) => (p.skip ? 1 : 0) + (p.group || "")).join(",") + "|" + jhaPagesOf(r).map((x) => x.id).join(",");
}

function packStamp(r) {
  return r.id + "|" + (r.updatedAt || "") + "|" + layoutKey(r) + "|" + (r.wx && r.wx.fetchedAt ? r.wx.fetchedAt : "");
}

function packMatches(pack, r) {
  return !!(pack && pack.ready && pack.blob && r && pack.stamp === packStamp(r));
}

function setShareBusy(busy) {
  const el = document.getElementById("layoutStatus");
  if (!el) return;
  if (busy) { el.className = "layout-status"; el.textContent = "Checking layout…"; return; }
  const info = preparedFiles && preparedFiles.info;
  if (!info) { el.className = "layout-status"; el.textContent = ""; return; }
  const names = ["Normal", "Compact", "Tight"];
  const jhaN = info.jhaPages || 0;
  const photoPages = info.totalPages - info.reportPages - jhaN;
  const fits = info.reportPages === 1;
  el.className = "layout-status " + (fits ? "ok" : "warn");
  el.textContent = (fits ? "✓ Report fits on 1 page" : "Report runs onto " + info.reportPages + " pages") +
    " · " + names[info.level] + " text" +
    (jhaN ? " · plus " + jhaN + " JHA page" + (jhaN > 1 ? "s" : "") : "") +
    (photoPages ? " · plus " + photoPages + " photo page" + (photoPages > 1 ? "s" : "") : "") +
    (info.blob ? " · " + (info.blob.size / 1000000).toFixed(1) + " MB" : "") +
    (!fits && info.level < 2 ? ". Try Tight." : "");
}

function queuePrepare() {
  clearTimeout(prepareTimer);
  prepareToken += 1;
  if (preparedFiles) preparedFiles.ready = false;
  setShareBusy(true);
  prepareTimer = setTimeout(() => { prepareSendFiles(); }, 300);
}

async function prepareSendFiles() {
  const r = active();
  if (!r || screen !== "wizard" || step !== 6) return;
  if (wxBusy) {
    prepareToken += 1;
    if (preparedFiles) preparedFiles.ready = false;
    setShareBusy(true);
    return;
  }
  const token = ++prepareToken;
  const stamp = packStamp(r);
  if (preparedFiles && preparedFiles.ready && preparedFiles.stamp === stamp) { setShareBusy(false); return; }
  preparedFiles = { stamp: stamp, ready: false, blob: null, info: null };
  setShareBusy(true);
  try {
    if (!window.jspdf) throw new Error("pdf");
    const info = await buildReportPdf(r);
    if (token !== prepareToken) return;
    const live = active();
    if (!live || packStamp(live) !== stamp || screen !== "wizard" || step !== 6) return;
    preparedFiles = { stamp: stamp, ready: true, blob: info.blob, info: info };
    setShareBusy(false);
  } catch (err) {
    if (token !== prepareToken) return;
    preparedFiles = { stamp: stamp, ready: false, blob: null, info: null };
    setShareBusy(false);
  }
}

function mailFallback(r, blob, email) {
  downloadBlob(blob, fileName(r));
  const subject = encodeURIComponent("Daily Project Summary — " + (r.projectNumber || "Project") + " — " + r.date);
  const body = encodeURIComponent(reportText(r) + "\n\n---\nAttach the downloaded PDF and job photos before sending.");
  window.location.href = "mailto:" + encodeURIComponent(email) + "?subject=" + subject + "&body=" + body;
  askSent = true;
  render();
}

function sendReport() {
  const r = active();
  const email = String((r && r.recipientEmail) || DEFAULT_EMAIL).trim();
  const copyP = navigator.clipboard && navigator.clipboard.writeText
    ? navigator.clipboard.writeText(email).then(() => true, () => false)
    : Promise.resolve(false);
  if (!r) return;
  if (!String(r.printName || "").trim() || !r.signatureDataUrl) {
    toast("Print name and signature are required.");
    return;
  }
  if (!window.jspdf) { toast("PDF library still loading — try again."); return; }
  const pack = preparedFiles;
  if (!packMatches(pack, r)) {
    toast("Still preparing the PDF.");
    prepareSendFiles();
    return;
  }
  rememberSettings(r);
  save();
  copyP.then((ok) => { if (ok) toast("Office email copied. Paste it in To."); });
  const files = [pack.pdfFile].concat(pack.photoFiles || []);
  const payload = {
    title: "Daily Project Summary — " + (r.projectNumber || "Project") + " — " + r.date,
    text: "Daily Project Summary for project " + (r.projectNumber || "—") + " on " + r.date + ". Please send to " + email + ".",
    files: files,
  };
  try {
    if (navigator.share && navigator.canShare && navigator.canShare(payload)) {
      navigator.share(payload).then(() => {
        askSent = true;
        render();
      }).catch((err) => {
        if (err && err.name === "AbortError") return;
        mailFallback(r, pack.blob, email);
      });
      return;
    }
  } catch (err) {}
  mailFallback(r, pack.blob, email);
}

function rememberSettings(r) {
  rememberJobName(r);
  const custom = [];
  r.manpower.forEach((row) => {
    const name = String(row.className || "").trim();
    if (!name || PRESETS.some((p) => p.toLowerCase() === name.toLowerCase())) return;
    const kind = row.kind === "equip" ? "equip" : "crew";
    if (!custom.some((c) => c.name.toLowerCase() === name.toLowerCase())) custom.push({ name: name, kind: kind });
  });
  const prev = normalizeRecent(store.settings.recentClasses).filter((c) => !custom.some((n) => n.name.toLowerCase() === c.name.toLowerCase()));
  store.settings.recentClasses = custom.concat(prev).slice(0, 12);
  const project = String(r.projectNumber || "").trim();
  if (project) store.settings.recentProjects = [project].concat(store.settings.recentProjects.filter((p) => p !== project)).slice(0, 8);
  store.settings.defaultName = String(r.printName || "").trim() || store.settings.defaultName;
  store.settings.defaultEmail = String(r.recipientEmail || "").trim() || DEFAULT_EMAIL;
  store.settings.lastProject = project || store.settings.lastProject;
  rememberLocation(r);
}

function markSent() {
  const r = active();
  if (!r) return;
  r.status = "sent";
  r.sentAt = new Date().toISOString();
  askSent = false;
  save();
  toast("Marked sent.");
  screen = "home";
  activeId = null;
  step = 0;
  render();
}

async function boot() {
  try {
    await load();
    render();
    loadLogo();
  } catch (err) {
    const el = document.getElementById("app");
    if (el) el.innerHTML = '<header class="hero"><h1>STX Daily</h1></header><main class="content"><div class="card"><p>Could not load the report app. Close Safari and open the link again.</p><p class="hint">' + esc(String(err)) + "</p></div></main>";
    console.error(err);
  }
}

if (!(typeof window !== "undefined" && window.__STX_NO_BOOT)) boot();
