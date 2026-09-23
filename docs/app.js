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
  teardownSig();
  const app = document.getElementById("app");
  if (!app) return;
  app.innerHTML = screen === "home" ? homeHtml() : wizardHtml();
  bind();
  hydratePhotos();
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
    const selected = Array.isArray(r.weather) ? r.weather : [];
    return '<div class="card"><h2>Summary of work performed</h2>' +
      ta("summary", r.summary, "Track work, surfacing, tie replacement, welding…") +
      "</div>" +
      '<div class="card"><h2>Weather</h2><div class="chips">' +
      WEATHER.map((w) => '<button type="button" class="chip' + (selected.indexOf(w) >= 0 ? " on" : "") + '" data-wx="' + esc(w) + '">' + esc(w) + "</button>").join("") +
      "</div>" +
      field("Temp °F", '<input inputmode="decimal" data-k="tempF" value="' + esc(r.tempF || "") + '" placeholder="°F" />') +
      ynRow("Did weather affect work today?", "weatherImpact", r.weatherImpact || "") +
      (r.weatherImpact === "yes" ? field("Explain", ta("weatherImpactExplain", r.weatherImpactExplain, "How did weather affect the work")) : "") +
      "</div>" +
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
        '<div class="row">' +
        field("QTY", '<input inputmode="decimal" data-row="manpower" data-id="' + row.id + '" data-f="qty" value="' + esc(row.qty) + '" />') +
        field("Hours", '<input inputmode="decimal" data-row="manpower" data-id="' + row.id + '" data-f="hours" value="' + esc(row.hours) + '" />') +
        "</div></div>").join("") +
      '<button class="btn btn-ghost" data-add="manpower">Add another class / equipment</button></div>' +
      '<div class="card"><h2>Subcontractors</h2>' +
      r.subcontractors.map((row) => '<div class="item"><div class="item-top"><span class="muted">Subcontractor</span>' +
        '<button class="btn btn-danger" style="width:auto;margin:0;padding:6px 10px;font-size:12px" data-rm="subcontractors" data-id="' + row.id + '">Remove</button></div>' +
        '<input data-row="subcontractors" data-id="' + row.id + '" data-f="description" value="' + esc(row.description) + '" placeholder="Company or crew" />' +
        '<div class="row">' + field("Hours", '<input inputmode="decimal" data-row="subcontractors" data-id="' + row.id + '" data-f="hours" value="' + esc(row.hours) + '" />') + "</div>" +
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
      '<div class="row">' +
      field("QTY", '<input inputmode="decimal" data-row="' + key + '" data-id="' + row.id + '" data-f="qty" value="' + esc(row.qty) + '" />') +
      field("UOM", '<input data-row="' + key + '" data-id="' + row.id + '" data-f="uom" value="' + esc(row.uom || "") + '" list="uom-options" placeholder="EA, LF, TN" autocapitalize="characters" />') +
      "</div>" +
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
    const extra = k === "pdfTitle" ? { pdfTitleCustom: true } : {};
    patch({ [k]: el.value, ...extra });
    const r = active();
    if (r && !r.pdfTitleCustom && (k === "date" || k === "projectNumber" || k === "printName")) {
      patch({ pdfTitle: autoTitle(r) });
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
  const delayLine = r.delaysYN === "yes"
    ? "Yes" + (r.delayHours ? ", " + r.delayHours + " hrs lost" : "") + (r.delays ? " — " + r.delays : "")
    : "No";
  return [
    "STX CORPORATION — DAILY PROJECT SUMMARY",
    "Date: " + (formatLong(r.date) || r.date),
    "Project #: " + (r.projectNumber || "—"),
    "Supervisor: " + (r.printName || "—"),
    "Weather: " + weather,
    "Temp F: " + (r.tempF || "—"),
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
  const weatherTxt = (Array.isArray(r.weather) ? r.weather : []).filter(Boolean).join(", ") || "—";
  const tempTxt = String(r.tempF || "").trim() ? String(r.tempF).trim() + "\u00B0F" : "—";
  const info = "Supervisor  " + (r.printName || "—") + "    ·    Weather  " + weatherTxt + "    ·    Temp  " + tempTxt;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  const infoLines = doc.splitTextToSize(info, contentW - 12);
  const infoH = infoLines.length * 11 + 8;
  doc.setFillColor(HEAD[0], HEAD[1], HEAD[2]);
  doc.rect(margin, y, contentW, infoH, "F");
  doc.setTextColor(INK[0], INK[1], INK[2]);
  doc.text(infoLines, margin + 6, y + 12);
  y += infoH + 6;

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
  return pack.id === r.id
    && pack.sig === (r.signatureDataUrl || "")
    && pack.title === String(r.pdfTitle || "")
    && pack.name === String(r.printName || "");
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
  const token = ++prepareToken;
  const sig = r.signatureDataUrl || "";
  const title = String(r.pdfTitle || "");
  const name = String(r.printName || "");
  preparedFiles = { id: r.id, sig: sig, title: title, name: name, token: token, ready: false, blob: null, pdfFile: null, photoFiles: [] };
  setShareBusy(true);
  try {
    if (!window.jspdf) throw new Error("pdf");
    const blob = await buildPdf(r);
    if (token !== prepareToken) return;
    const live = active();
    if (!live || live.id !== r.id || screen !== "wizard" || step !== 6) return;
    if ((live.signatureDataUrl || "") !== sig || String(live.pdfTitle || "") !== title || String(live.printName || "") !== name) return;
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
    preparedFiles = { id: live.id, sig: sig, title: title, name: name, token: token, ready: true, blob: blob, pdfFile: pdfFile, photoFiles: photoFiles };
    setShareBusy(false);
  } catch (err) {
    if (token !== prepareToken) return;
    preparedFiles = { id: r.id, sig: sig, title: title, name: name, token: token, ready: false, blob: null, pdfFile: null, photoFiles: [] };
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
