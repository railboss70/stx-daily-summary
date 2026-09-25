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
const emptyRow = {
  received: () => ({ id: uid(), description: "", qty: "", uom: "", bolFiled: "" }),
  consumed: () => ({ id: uid(), description: "", qty: "", uom: "" }),
  manpower: () => ({ id: uid(), className: "", qty: "", hours: "", kind: "crew" }),
  sub: () => ({ id: uid(), description: "", hours: "", details: "" }),
};

function freshSettings() {
  return {
    defaultName: "",
    defaultEmail: DEFAULT_EMAIL,
    lastProject: "",
    recentProjects: [],
    recentClasses: [],
    projectLocations: {},
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
    printName: s.defaultName || "",
    summary: "",
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
    photos: [],
    signatureDataUrl: "",
    recipientEmail: s.defaultEmail || DEFAULT_EMAIL,
    pdfTitle: "",
    pdfTitleCustom: false,
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
          });
        } catch (err) {
          nextPhotos.push(photo);
        }
      } else {
        nextPhotos.push({ id: photo.id, caption: photo.caption || "", takenAt: photo.takenAt || "" });
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
    if (!r.photos.length) continue;
    for (let p = 0; p < r.photos.length; p += 1) await deletePhoto(r.photos[p].id);
    r.photos = [];
    r.photosPurged = true;
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
  return '<div class="logo-chip"><img src="./stx-logo.png" alt="STX Corporation" /></div>';
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
    if (k) focusSel = '[data-k="' + k + '"]';
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
      : '<button class="btn btn-gold" data-act="send" disabled>Preparing…</button>') +
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
    const first = stations && stations.features && stations.features[0] && stations.features[0].properties;
    if (!first || !first.stationIdentifier) throw new Error("station");
    const start = new Date(zonedTime(r.date, 6, 0, tz)).toISOString();
    const end = new Date(zonedTime(r.date, 18, 0, tz)).toISOString();
    const obsUrl = "https://api.weather.gov/stations/" + encodeURIComponent(first.stationIdentifier) + "/observations?start=" + encodeURIComponent(start) + "&end=" + encodeURIComponent(end);
    const obs = await fetchJson(obsUrl);
    if (token !== wxToken) return;
    const slots = SLOT_TIMES.map((target) => buildSlot(target, r.date, tz, (obs && obs.features) || []));
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
    wxError = "Weather unavailable. No signal.";
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

function weatherManual(r) {
  const selected = Array.isArray(r.weather) ? r.weather : [];
  return '<div class="chips">' +
    WEATHER.map((w) => '<button type="button" class="chip' + (selected.indexOf(w) >= 0 ? " on" : "") + '" data-wx="' + esc(w) + '">' + esc(w) + "</button>").join("") +
    "</div>" +
    field("Temp °F", '<input inputmode="decimal" data-k="tempF" value="' + esc(r.tempF || "") + '" placeholder="°F" />');
}

function slotHtml(slot) {
  const label = esc((slot && slot.t) || "");
  if (!slot || slot.status === "later") return '<div class="wx-col"><div class="wx-time">' + label + '</div><div class="wx-cond">Later today.</div></div>';
  if (slot.status !== "ok") return '<div class="wx-col"><div class="wx-time">' + label + '</div><div class="wx-cond">No reading.</div></div>';
  const temp = slot.tempF === "" || slot.tempF == null ? "—" : slot.tempF + "°";
  return '<div class="wx-col"><div class="wx-time">' + label + "</div>" + wxSvg(slot.icon) +
    '<div class="wx-temp">' + esc(temp) + "</div>" +
    '<div class="wx-cond">' + esc(slot.cond || "") + "</div>" +
    '<div class="wx-meta">Precip ' + esc(slot.precip || "—") + "<br>Wind " + esc(slot.wind || "—") + "<br>Humidity " + esc(slot.hum || "—") + "</div></div>";
}

function weatherCard(r) {
  const cityRow = '<div class="row loc"><div>' +
    field("Job city", input("jobCity", r.jobCity, 'placeholder="Houston" autocapitalize="words"')) +
    "</div><div>" +
    field("State", '<input data-k="jobState" value="' + esc(r.jobState || "") + '" maxlength="2" autocapitalize="characters" placeholder="TX" />') +
    "</div></div>";
  const hasCity = !!String(r.jobCity || "").trim() && String(r.jobState || "").trim().length >= 2;
  const hasSlots = !!(r.wx && r.wx.placeKey === placeKey(r) && Array.isArray(r.wx.slots) && r.wx.slots.length);
  const offline = typeof navigator !== "undefined" && navigator.onLine === false;
  let body = "";
  if (!weatherDateOk(r.date)) {
    body = '<p class="hint">Observed weather is only available for the last 7 days. Enter it below.</p>' + weatherManual(r);
  } else {
    body = '<button type="button" class="btn btn-outline" data-act="wxrefresh"' + (wxLoading ? " disabled" : "") + ">" +
      (wxLoading ? '<i class="spin"></i> Loading weather…' : "Refresh weather") + "</button>";
    if (wxError) body += '<p class="hint">' + esc(wxError) + "</p>";
    else if (offline && hasCity && !hasSlots) body += '<p class="hint">Weather unavailable. No signal.</p>';
    if (!hasCity) body += '<p class="hint">Enter the job city and state.</p>';
    if (hasSlots) {
      body += '<div class="wx-grid">' + r.wx.slots.map(slotHtml).join("") + "</div>";
      if (r.wx.station) body += '<p class="wx-src">Source: National Weather Service · ' + esc(r.wx.station) + " " + esc(r.wx.stationName || "") + "</p>";
    }
    if (wxError || wxManualOpen || (offline && hasCity && !hasSlots)) body += weatherManual(r);
    else if (hasSlots) body += '<button type="button" class="btn btn-ghost" data-act="wxmanual">Enter weather manually</button>';
  }
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
      field("Date", '<input type="date" data-k="date" value="' + esc(r.date) + '" />') +
      field("Project number", input("projectNumber", r.projectNumber, 'placeholder="Project number" inputmode="numeric"')) +
      recentChips() +
      field("Print name", input("printName", r.printName, 'placeholder="Your name" autocomplete="name" autocapitalize="words"')) +
      "</div>";
  }
  if (step === 1) {
    return '<div class="card"><h2>Summary of work performed</h2>' +
      ta("summary", r.summary, "Track work, surfacing, tie replacement, welding…") +
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
      '<div class="card"><h2>Subcontractors</h2>' +
      r.subcontractors.map((row) => '<div class="item"><div class="item-top"><span class="muted">Subcontractor</span>' +
        '<button class="btn btn-danger" style="width:auto;margin:0;padding:6px 10px;font-size:12px" data-rm="subcontractors" data-id="' + row.id + '">Remove</button></div>' +
        '<input data-row="subcontractors" data-id="' + row.id + '" data-f="description" value="' + esc(row.description) + '" placeholder="Company or crew" />' +
        '<div class="row"><div>' + field("Hours", '<input inputmode="decimal" data-row="subcontractors" data-id="' + row.id + '" data-f="hours" value="' + esc(row.hours) + '" />') + "</div></div>" +
        field("Details", '<input data-row="subcontractors" data-id="' + row.id + '" data-f="details" value="' + esc(row.details) + '" placeholder="Work performed" />') +
        "</div>").join("") +
      '<button class="btn btn-ghost" data-add="subcontractors">Add subcontractor</button></div>';
  }
  if (step === 4) {
    return ynCard("Any incidents today?", "incidents", r.incidents, "incidentsExplain", r.incidentsExplain, "yes") +
      ynCard("Any near misses today?", "nearMiss", r.nearMiss, "nearMissExplain", r.nearMissExplain, "yes") +
      ynCard("Any equipment issues today?", "equipmentIssues", r.equipmentIssues, "equipmentIssuesExplain", r.equipmentIssuesExplain, "yes") +
      '<div class="card"><h2>Before leaving the site</h2>' +
      ynRow("Site secure before leaving", "siteSecure", r.siteSecure, "no") +
      ynRow("Derails down", "derailsDown", r.derailsDown, "no") +
      ynRow("All locks removed", "locksRemoved", r.locksRemoved, "no") +
      "</div>";
  }
  if (step === 5) {
    const purgedNote = !!r.photosPurged && !(r.photos || []).length;
    return '<div class="card"><h2>Job photos</h2>' +
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
    '<div class="card">' +
    '<p class="hint">Share the PDF (and photos) to Mail so it lands at the office. On iPhone use the Mail app, not a browser tab.</p>' +
    '<button class="btn btn-outline" data-act="preview">Preview PDF</button>' +
    '<button class="btn btn-gold" data-act="send" data-share="1" disabled>Preparing…</button>' +
    '<button class="btn btn-ghost" data-act="pdf">Download PDF only</button></div>' +
    (askSent
      ? '<div class="card"><h2>Did the email go out?</h2>' +
        '<p class="hint">Only mark it sent after the office actually gets it.</p>' +
        '<button class="btn btn-navy" data-act="sent-yes">Yes, mark sent</button>' +
        '<button class="btn btn-ghost" data-act="sent-no">Not yet</button></div>'
      : "");
}

function recentChips() {
  const rec = store.settings.recentProjects || [];
  if (!rec.length) return "";
  return '<div class="chips">' + rec.map((p) => '<button type="button" class="chip" data-proj="' + esc(p) + '">' + esc(p) + "</button>").join("") + "</div>";
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
    if (k === "projectNumber") applySavedLocation();
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
    patch({});
  }));
  document.querySelectorAll("[data-add]").forEach((b) => b.addEventListener("click", () => {
    const key = b.getAttribute("data-add");
    const r = active();
    const maker = key === "manpower" ? emptyRow.manpower : key === "subcontractors" ? emptyRow.sub : key === "consumed" ? emptyRow.consumed : emptyRow.received;
    r[key] = r[key].concat([maker()]);
    save();
    render();
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
    const blank = key === "manpower" ? emptyRow.manpower : key === "subcontractors" ? emptyRow.sub : key === "consumed" ? emptyRow.consumed : emptyRow.received;
    r[key] = r[key].length <= 1 ? r[key].map((row) => row.id === id ? blank() : row) : r[key].filter((row) => row.id !== id);
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
    render();
  }));
  document.querySelectorAll("[data-yn]").forEach((b) => b.addEventListener("click", () => {
    patch({ [b.getAttribute("data-yn")]: b.getAttribute("data-v") });
    render();
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
  if (!r || !String(r.projectNumber || "").trim() || !String(r.printName || "").trim()) {
    toast("Project number and name are required.");
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
  render();
}

async function removeReport(id) {
  const r = store.reports[id];
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
      const maxEdge = 1024;
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
      }, "image/jpeg", 0.6);
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

function yn(v) { return v === "yes" ? "YES" : v === "no" ? "NO" : "—"; }

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
  const subs = r.subcontractors.filter((x) => String(x.description || "").trim()).map((x) => "  • " + x.description + "  hrs " + (x.hours || "—") + (x.details ? "\n    " + x.details : "")).join("\n");
  const weather = (r.weather || []).join(", ") || "—";
  const city = String(r.jobCity || "").trim();
  const st = String(r.jobState || "").trim().toUpperCase();
  const locLine = city ? "Job location: " + city + (st ? ", " + st : "") : "";
  let weatherLines;
  if (wxReady(r)) {
    weatherLines = ["Observed weather (National Weather Service · station " + (r.wx.station || "") + " " + (r.wx.stationName || "") + "):"];
    (r.wx.slots || []).forEach((s) => {
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
    "Project #: " + (r.projectNumber || "—"),
    "Supervisor: " + (r.printName || "—"),
    locLine,
    ...weatherLines,
    "", "SUMMARY OF WORK PERFORMED", String(r.summary || "").trim() || "—",
    "", "DELAYS / INTERRUPTIONS", delayLine,
    r.weatherImpact === "yes" ? "WEATHER IMPACT: " + (r.weatherImpactExplain || "Yes") : "",
    "", "RECEIVED AND ACCOUNTED MATERIALS", rec || "  (none)",
    "", "MATERIALS CONSUMED", con || "  (none)",
    "", "MANPOWER AND EQUIPMENT", crew || "  (none)",
    "Total man-hours (employees): " + manHours(ordered),
    ordered.some((x) => x.kind === "equip") ? "Equipment hours: " + hoursOf(ordered, "equip") : "",
    "", "SUBCONTRACTORS", subs || "  (none)",
    "", "Any incidents today: " + yn(r.incidents), r.incidents === "yes" ? r.incidentsExplain : "",
    "Any near misses today: " + yn(r.nearMiss), r.nearMiss === "yes" ? r.nearMissExplain : "",
    "Any equipment issues today: " + yn(r.equipmentIssues), r.equipmentIssues === "yes" ? r.equipmentIssuesExplain : "",
    "Site secure before leaving: " + yn(r.siteSecure),
    "Derails down: " + yn(r.derailsDown),
    "All locks removed: " + yn(r.locksRemoved),
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
    const res = await fetch("./stx-logo-pdf.jpg");
    const blob = await res.blob();
    cachedLogo = await blobToDataUrl(blob);
  } catch (e) {
    cachedLogo = "";
  }
  return cachedLogo;
}

async function resolvePhoto(p) {
  if (p && p.dataUrl) return p.dataUrl;
  if (!p || !p.id) return "";
  try {
    const blob = await getPhoto(p.id);
    if (!blob) return "";
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

async function buildPdf(r) {
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
    doc.text("Project # " + (r.projectNumber || "—") + "  ·  " + (formatLong(r.date) || r.date) + "  ·  continued", margin, 22);
    y = 34;
  }

  function paintBar(title, continued) {
    const label = String(title).toUpperCase() + (continued ? " (continued)" : "");
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.rect(margin, y, contentW, 14, "F");
    doc.setTextColor(255, 252, 245);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(label, margin + 6, y + 10);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    y += 14;
  }

  function writeBody(text) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    const lines = doc.splitTextToSize(String(text || "—"), contentW - 12);
    lines.forEach((line) => {
      if (y + 11 > contentBottom) newPage();
      doc.text(line, margin + 6, y + 9);
      y += 11;
    });
    y += 4;
  }

  function openText(title, text) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const lines = doc.splitTextToSize(String(text || "—"), contentW - 12);
    const follow = Math.min(2, Math.max(lines.length, 1)) * 11 + 2;
    if (y + 14 + follow > contentBottom) newPage();
    paintBar(title, false);
    writeBody(text);
  }

  function measureRow(cells, widths) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const wrapped = cells.map((cell, i) => doc.splitTextToSize(String(cell == null ? "" : cell), widths[i] - 8));
    let lines = 1;
    wrapped.forEach((w) => { if (w.length > lines) lines = w.length; });
    return { wrapped: wrapped, h: Math.max(14, lines * 11 + 3) };
  }

  function paintHead(headers, widths) {
    doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
    doc.rect(margin, y, contentW, 13, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    let x = margin;
    headers.forEach((h, i) => {
      doc.text(String(h), x + 4, y + 9);
      x += widths[i];
    });
    y += 13;
  }

  function paintRow(measured, widths) {
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.4);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    let x = margin;
    widths.forEach((w, i) => {
      doc.rect(x, y, w, measured.h);
      doc.text(measured.wrapped[i], x + 4, y + 11);
      x += w;
    });
    y += measured.h;
  }

  function drawTable(title, headers, rows, widths) {
    if (!rows.length) {
      if (y + 14 + 16 > contentBottom) newPage();
      paintBar(title, false);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      doc.setTextColor(INK[0], INK[1], INK[2]);
      doc.text("None", margin + 6, y + 12);
      y += 18;
      return;
    }
    const measured = rows.map((row) => measureRow(row, widths));
    if (y + 14 + 13 + measured[0].h > contentBottom) newPage();
    paintBar(title, false);
    paintHead(headers, widths);
    rows.forEach((row, idx) => {
      const m = measured[idx];
      if (y + m.h > contentBottom && y > 80) {
        newPage();
        paintBar(title, true);
        paintHead(headers, widths);
      }
      paintRow(m, widths);
    });
    y += 4;
  }

  doc.setFillColor(255, 252, 245);
  doc.rect(0, 0, pageW, 76, "F");
  if (logo) {
    try { fitAddImage(doc, logo, margin, 10, 250, 56); } catch (e) {}
  }
  doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("DAILY PROJECT SUMMARY", pageW - margin, 30, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(formatLong(r.date) || r.date || "", pageW - margin, 46, { align: "right" });
  doc.text("Project # " + (r.projectNumber || "—"), pageW - margin, 58, { align: "right" });
  doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
  doc.rect(0, 76, pageW, 2, "F");
  doc.setFillColor(196, 154, 54);
  doc.rect(0, 78, pageW, 3, "F");

  y = 88;
  const hasWx = wxReady(r);
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
  const infoH = infoLines.length * 11 + 8;
  doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
  doc.rect(margin, y, contentW, infoH, "F");
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(infoLines, margin + 6, y + 12);
  y += infoH + 6;

  if (hasWx) {
    if (y + 104 > contentBottom) newPage();
    const city = String(r.jobCity || "").trim();
    const st = String(r.jobState || "").trim().toUpperCase();
    const place = city ? city + (st ? ", " + st : "") : "";
    paintBar("Weather · " + place, false);
    const boxTop = y;
    const boxH = 74;
    const colW = contentW / 3;
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.7);
    doc.rect(margin, boxTop, contentW, boxH, "FD");
    const slots = Array.isArray(r.wx.slots) ? r.wx.slots : [];
    for (let i = 0; i < 3; i += 1) {
      const slot = slots[i] || blankSlot(SLOT_TIMES[i].t, "miss", "No reading.");
      const x = margin + i * colW;
      const ix = x + 26;
      const iy = boxTop + 24;
      if (slot.status === "ok" && slot.icon) drawWxIcon(doc, slot.icon, ix, iy);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(String(slot.t || ""), ix, boxTop + 50, { align: "center" });
      const tx = x + 48;
      const textW = colW - 56;
      if (slot.status !== "ok") {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(9);
        doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
        const msg = slot.status === "later" ? "Later today." : "No reading.";
        doc.text(doc.splitTextToSize(msg, textW), tx, boxTop + 32);
      } else {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(INK[0], INK[1], INK[2]);
        doc.text(slot.tempF ? slot.tempF + "\u00B0" : "—", tx, boxTop + 26);
        doc.setFontSize(8);
        doc.setTextColor(NAVY[0], NAVY[1], NAVY[2]);
        let cond = String(slot.cond || "");
        const condLines = doc.splitTextToSize(cond, textW);
        if (condLines.length > 1) cond = String(condLines[0]).replace(/\s+\S*$/, "") + "...";
        doc.text(cond || "—", tx, boxTop + 38);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7.5);
        doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
        const meta = [
          "Precipitation  " + (slot.precip || "—"),
          "Wind  " + (slot.wind || "—"),
          "Humidity  " + (slot.hum || "—"),
        ];
        meta.forEach((line, mi) => doc.text(line, tx, boxTop + 50 + mi * 8));
      }
    }
    doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
    doc.setLineWidth(0.7);
    doc.rect(margin, boxTop, contentW, boxH);
    doc.setLineWidth(0.4);
    doc.line(margin + colW, boxTop, margin + colW, boxTop + boxH);
    doc.line(margin + colW * 2, boxTop, margin + colW * 2, boxTop + boxH);
    y = boxTop + boxH + 11;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    const src = "Source: National Weather Service · Station " + (r.wx.station || "") + " (" + (r.wx.stationName || "") + ") · observed readings";
    const srcLines = doc.splitTextToSize(src, contentW - 12);
    srcLines.forEach((line) => {
      doc.text(line, margin + contentW / 2, y, { align: "center" });
      y += 9;
    });
    y += 4;
    doc.setLineWidth(0.4);
  }

  openText("Summary of work performed", String(r.summary || "").trim() || "—");

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
  drawTable(
    "Manpower and equipment",
    crewHeads,
    ordered.map((x) => [x.className, x.kind === "equip" ? "Equip" : "Crew", x.qty || "—", x.hours || "—"]),
    crewWidths
  );
  if (ordered.length) {
    const equipRows = ordered.filter((x) => x.kind === "equip");
    const totalLines = equipRows.length ? 2 : 1;
    if (y + totalLines * 16 + 4 > contentBottom) {
      newPage();
      paintBar("Manpower and equipment", true);
      paintHead(crewHeads, crewWidths);
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text("Total man-hours (employees)", margin + 6, y + 12);
    doc.text(String(manHours(ordered)), margin + contentW - 6, y + 12, { align: "right" });
    y += 16;
    if (equipRows.length) {
      doc.setFont("helvetica", "normal");
      doc.text("Equipment hours", margin + 6, y + 12);
      doc.text(String(hoursOf(ordered, "equip")), margin + contentW - 6, y + 12, { align: "right" });
      y += 16;
    }
    y += 4;
  }

  const subs = (r.subcontractors || []).filter((x) => String(x.description || "").trim());
  drawTable(
    "Subcontractors",
    ["Description", "Hours"],
    subs.map((x) => [x.description + (x.details ? " — " + x.details : ""), x.hours || "—"]),
    [432, 100]
  );

  const safety = [
    ["Incidents", r.incidents, "yes"],
    ["Near misses", r.nearMiss, "yes"],
    ["Equipment issues", r.equipmentIssues, "yes"],
    ["Site secure", r.siteSecure, "no"],
    ["Derails down", r.derailsDown, "no"],
    ["Locks removed", r.locksRemoved, "no"],
  ];
  const notes = [];
  if (r.incidents === "yes" && String(r.incidentsExplain || "").trim()) notes.push("Incidents: " + String(r.incidentsExplain).trim());
  if (r.nearMiss === "yes" && String(r.nearMissExplain || "").trim()) notes.push("Near misses: " + String(r.nearMissExplain).trim());
  if (r.equipmentIssues === "yes" && String(r.equipmentIssuesExplain || "").trim()) notes.push("Equipment issues: " + String(r.equipmentIssuesExplain).trim());
  const gridH = 48;
  const safetyFollow = gridH + (notes.length ? 22 : 0);
  if (y + 14 + safetyFollow > contentBottom) newPage();
  paintBar("Safety and closeout", false);
  const gridTop = y;
  const colW = contentW / 2;
  const rowH = 16;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.setLineWidth(0.4);
  doc.rect(margin, gridTop, contentW, gridH);
  doc.line(margin + colW, gridTop, margin + colW, gridTop + gridH);
  doc.line(margin, gridTop + rowH, margin + contentW, gridTop + rowH);
  doc.line(margin, gridTop + rowH * 2, margin + contentW, gridTop + rowH * 2);
  safety.forEach((item, i) => {
    const col = i % 2;
    const row = Math.floor(i / 2);
    const x = margin + col * colW;
    const yy = gridTop + row * rowH;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.text(item[0], x + 6, yy + 11);
    const value = yn(item[1]);
    const alert = item[2] && item[1] === item[2];
    doc.setFont("helvetica", "bold");
    if (alert) doc.setTextColor(RED[0], RED[1], RED[2]);
    doc.text(value, x + colW - 8, yy + 11, { align: "right" });
  });
  y = gridTop + gridH + 6;
  notes.forEach((note) => writeBody(note));

  const blockH = 58;
  if (y + blockH > contentBottom) newPage();
  const top = y;
  doc.setDrawColor(LINE[0], LINE[1], LINE[2]);
  doc.setLineWidth(0.7);
  doc.line(margin, top + 36, margin + 200, top + 36);
  doc.line(margin + 240, top + 36, margin + contentW, top + 36);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(r.printName || " ", margin, top + 30);
  if (r.signatureDataUrl) {
    try { doc.addImage(r.signatureDataUrl, "PNG", margin + 240, top, 170, 34, undefined, "FAST"); } catch (e) {}
  }
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
  doc.text("PRINT NAME", margin, top + 48);
  doc.text("SIGNATURE", margin + 240, top + 48);
  y = top + blockH;

  if (r.photosPurged && !(r.photos || []).length) {
    const note = "Photos removed from phone after 14 days (sent copy is on file).";
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    const noteLines = doc.splitTextToSize(note, contentW);
    if (y + noteLines.length * 12 + 4 > contentBottom) newPage();
    doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
    doc.text(noteLines, margin, y + 11);
    y += noteLines.length * 12 + 4;
  }

  const photos = [];
  const srcPhotos = r.photos || [];
  for (let i = 0; i < srcPhotos.length; i += 1) {
    const p = srcPhotos[i];
    const dataUrl = await resolvePhoto(p);
    if (!dataUrl) continue;
    photos.push({ caption: p.caption || "", takenAt: p.takenAt || "", dataUrl: dataUrl });
  }
  photos.forEach((p, i) => {
    doc.addPage();
    doc.setFillColor(NAVY[0], NAVY[1], NAVY[2]);
    doc.rect(0, 0, pageW, 36, "F");
    doc.setTextColor(255, 252, 245);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(
      "Photo " + (i + 1) + " of " + photos.length + "  ·  Project # " + (r.projectNumber || "—") + "  ·  " + (formatLong(r.date) || r.date),
      margin,
      23
    );
    let py = 54;
    const caption = String(p.caption || "").trim() || "No description";
    doc.setTextColor(INK[0], INK[1], INK[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    const capLines = doc.splitTextToSize(caption, contentW);
    doc.text(capLines, margin, py);
    py += capLines.length * 18;
    const when = formatTaken(p.takenAt);
    if (when) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.setTextColor(MUTED[0], MUTED[1], MUTED[2]);
      doc.text(when, margin, py);
      py += 16;
    }
    py += 8;
    const boxH = pageH - 40 - py;
    if (p.dataUrl && boxH > 40) {
      try { placeFitted(doc, p.dataUrl, margin, py, contentW, boxH); } catch (e) {}
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
  return doc.output("blob");
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
  if (!window.jspdf) { toast("PDF library still loading — try again."); return; }
  const w = window.open("", "_blank");
  try {
    const pack = preparedFiles;
    const blob = packMatches(pack, r) ? pack.blob : await buildPdf(r);
    const url = URL.createObjectURL(blob);
    if (w) w.location = url;
    else {
      downloadBlob(blob, fileName(r));
      toast("Preview blocked. PDF downloaded instead.");
    }
  } catch (err) {
    if (w && w.close) w.close();
    toast("Could not build the PDF.");
  }
}

function packMatches(pack, r) {
  if (!pack || !pack.ready || !pack.blob || !r) return false;
  const wxStamp = r.wx && r.wx.fetchedAt ? String(r.wx.fetchedAt) : "";
  return pack.id === r.id
    && pack.sig === (r.signatureDataUrl || "")
    && pack.title === String(r.pdfTitle || "")
    && pack.name === String(r.printName || "")
    && pack.wx === wxStamp;
}

function setShareBusy(busy) {
  document.querySelectorAll('[data-act="send"]').forEach((b) => {
    b.disabled = !!busy;
    b.textContent = busy ? "Preparing…" : (b.getAttribute("data-share") === "1" ? "Share PDF + photos" : "Send report");
  });
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
  const sig = r.signatureDataUrl || "";
  const title = String(r.pdfTitle || "");
  const name = String(r.printName || "");
  const wxStamp = r.wx && r.wx.fetchedAt ? String(r.wx.fetchedAt) : "";
  preparedFiles = { id: r.id, sig: sig, title: title, name: name, wx: wxStamp, token: token, ready: false, blob: null, pdfFile: null, photoFiles: [] };
  setShareBusy(true);
  try {
    if (!window.jspdf) throw new Error("pdf");
    const blob = await buildPdf(r);
    if (token !== prepareToken) return;
    const live = active();
    if (!live || live.id !== r.id || screen !== "wizard" || step !== 6) return;
    if ((live.signatureDataUrl || "") !== sig || String(live.pdfTitle || "") !== title || String(live.printName || "") !== name) return;
    const liveWx = live.wx && live.wx.fetchedAt ? String(live.wx.fetchedAt) : "";
    if (liveWx !== wxStamp) return;
    const pdfFile = new File([blob], fileName(live), { type: "application/pdf" });
    const photoFiles = [];
    const list = live.photos || [];
    for (let i = 0; i < list.length; i += 1) {
      if (token !== prepareToken) return;
      let b = null;
      try { b = await getPhoto(list[i].id); } catch (e) { b = null; }
      if (token !== prepareToken) return;
      if (b) photoFiles.push(new File([b], "job-photo-" + (i + 1) + ".jpg", { type: b.type || "image/jpeg" }));
    }
    if (token !== prepareToken) return;
    const now = active();
    if (!now || (now.signatureDataUrl || "") !== sig) return;
    preparedFiles = { id: live.id, sig: sig, title: title, name: name, wx: wxStamp, token: token, ready: true, blob: blob, pdfFile: pdfFile, photoFiles: photoFiles };
    setShareBusy(false);
  } catch (err) {
    if (token !== prepareToken) return;
    preparedFiles = { id: r.id, sig: sig, title: title, name: name, wx: wxStamp, token: token, ready: false, blob: null, pdfFile: null, photoFiles: [] };
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
