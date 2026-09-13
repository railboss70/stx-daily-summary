const DEFAULT_EMAIL = "reports@stxrailroad.com";
const PRESETS = [
  "Foreman", "Laborer", "Operator", "Hi-Rail Operator", "Truck Driver",
  "Welder", "Flagman", "Excavator", "Tamper", "Regulator", "Spike Driver",
  "Loader", "Pickup",
];
const STEPS = ["Job", "Work", "Materials", "Crew", "Closeout", "Photos", "Send"];
const KEY = "stx-dps-pages-v1";

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const todayISO = () => {
  const d = new Date();
  const z = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`;
};
const formatLong = (iso) => {
  if (!iso) return "";
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric", year: "numeric",
  });
};
const emptyRow = {
  received: () => ({ id: uid(), description: "", qty: "", bolFiled: "" }),
  consumed: () => ({ id: uid(), description: "", qty: "" }),
  manpower: () => ({ id: uid(), className: "", qty: "", hours: "" }),
  sub: () => ({ id: uid(), description: "", hours: "", details: "" }),
};

function blankReport(settings) {
  const now = new Date().toISOString();
  return {
    id: uid(),
    status: "draft",
    createdAt: now,
    updatedAt: now,
    date: todayISO(),
    projectNumber: settings.lastProject || "",
    printName: settings.defaultName || "",
    summary: "",
    delays: "",
    received: [emptyRow.received()],
    consumed: [emptyRow.consumed()],
    manpower: [emptyRow.manpower()],
    subcontractors: [emptyRow.sub()],
    incidents: "",
    incidentsExplain: "",
    equipmentIssues: "",
    equipmentIssuesExplain: "",
    siteSecure: "",
    derailsDown: "",
    locksRemoved: "",
    photos: [],
    signatureDataUrl: "",
    recipientEmail: settings.defaultEmail || DEFAULT_EMAIL,
    pdfTitle: "",
    pdfTitleCustom: false,
  };
}

let store = {
  reports: {},
  order: [],
  settings: {
    defaultName: "",
    defaultEmail: DEFAULT_EMAIL,
    lastProject: "",
    recentProjects: [],
    recentClasses: [],
  },
};
let screen = "home";
let activeId = null;
let step = 0;

function load() {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) || "null");
    if (raw && raw.reports) store = { ...store, ...raw, settings: { ...store.settings, ...raw.settings } };
  } catch {}
  if ((store.settings.defaultEmail || "").includes("stxrrailroad")) {
    store.settings.defaultEmail = DEFAULT_EMAIL;
  }
  Object.values(store.reports).forEach((r) => {
    if ((r.recipientEmail || "").includes("stxrrailroad")) r.recipientEmail = DEFAULT_EMAIL;
    if (!Array.isArray(r.photos)) r.photos = [];
  });
  save();
}
function save() {
  localStorage.setItem(KEY, JSON.stringify(store));
}

function toast(msg) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.style.display = "block";
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { el.style.display = "none"; }, 2200);
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
  return `<svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
    <rect width="32" height="32" rx="6" fill="#F3F0E8"/>
    <polygon points="16,5 27,27 5,27" fill="#0C2340"/>
    <polygon points="16,12 22,24 10,24" fill="#F3F0E8"/>
  </svg>`;
}

function field(label, inner) {
  return `<label>${label}</label>${inner}`;
}
function input(name, value, extra = "") {
  return `<input data-k="${name}" value="${esc(value || "")}" ${extra} />`;
}
function ta(name, value, ph = "") {
  return `<textarea data-k="${name}" placeholder="${esc(ph)}">${esc(value || "")}</textarea>`;
}
function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (ch) => {
    if (ch === "&") return "\u0026amp;";
    if (ch === "<") return "\u0026lt;";
    if (ch === ">") return "\u0026gt;";
    return "\u0026quot;";
  });
}

function render() {
  document.getElementById("app").innerHTML = screen === "home" ? homeHtml() : wizardHtml();
  bind();
}

function homeHtml() {
  const items = list();
  const today = todayISO();
  const drafts = items.filter((r) => r.status === "draft");
  const sent = items.filter((r) => r.status === "sent");
  const s = store.settings;
  const group = (title, rows, empty) => `
    <div class="card">
      <h2>${title}</h2>
      ${rows.length ? rows.map((r) => `
        <div class="list-row" data-open="${r.id}">
          <div>
            <b>${esc(r.projectNumber || "No project #")}</b>
            <div class="muted">${esc(formatLong(r.date))}${r.printName ? " · " + esc(r.printName) : ""}</div>
          </div>
          <button class="btn btn-danger" style="width:auto;margin:0;padding:8px 10px;font-size:13px" data-del="${r.id}">Delete</button>
        </div>`).join("") : `<p class="empty">${empty}</p>`}
    </div>`;
  return `
    <header class="hero">
      ${markSvg()}
      <small>Railroad construction services</small>
      <h1>Daily Project Summary</h1>
      <p class="date">${esc(formatLong(today))}</p>
    </header>
    <main class="content">
      <button class="btn btn-navy" data-act="start">${drafts.some((r) => r.date === today) ? "Continue today's report" : "Start today's report"}</button>
      ${items.length ? `<button class="btn btn-outline" data-act="fromlast">New from last crew</button>` : ""}
      ${group("Drafts", drafts, "No drafts. Start a report for the shift.")}
      ${group("Sent", sent, "Sent reports land here after you share them.")}
      <div class="card">
        <h2>Supervisor defaults</h2>
        ${field("Your name", `<input data-set="defaultName" value="${esc(s.defaultName)}" placeholder="Print name on reports" autocomplete="name" autocapitalize="words" />`)}
        ${field("Send reports to", `<input type="email" inputmode="email" data-set="defaultEmail" value="${esc(s.defaultEmail)}" placeholder="${DEFAULT_EMAIL}" />`)}
        <p class="hint">Office default is ${DEFAULT_EMAIL}</p>
      </div>
    </main>`;
}

function wizardHtml() {
  const r = active();
  if (!r) return homeHtml();
  return `
    <header class="hero" style="padding-bottom:14px">
      <div class="brand">${markSvg()}<div>
        <small>Daily project summary</small>
        <div style="font-size:18px;font-weight:800;letter-spacing:.04em">STX</div>
      </div></div>
      <div class="muted" style="color:rgba(255,252,245,.75);margin-top:8px">${STEPS[step]} · ${step + 1} of ${STEPS.length}</div>
    </header>
    <main class="content">
      <div class="steps">${STEPS.map((_, i) => `<i class="${i <= step ? "on" : ""}"></i>`).join("")}</div>
      ${stepHtml(r)}
      <div class="nav">
        <button class="btn btn-ghost" data-act="${step === 0 ? "home" : "back"}">${step === 0 ? "Home" : "Back"}</button>
        ${step < STEPS.length - 1
          ? `<button class="btn btn-navy" data-act="next">Next</button>`
          : `<button class="btn btn-gold" data-act="send">Send report</button>`}
      </div>
    </main>`;
}

function stepHtml(r) {
  if (step === 0) {
    return `<div class="card"><h2>Job information</h2>
      ${field("Date", `<input type="date" data-k="date" value="${esc(r.date)}" />`)}
      ${field("Project number", input("projectNumber", r.projectNumber, 'placeholder="Project number" inputmode="numeric"'))}
      ${recentChips()}
      ${field("Print name", input("printName", r.printName, 'placeholder="Your name" autocomplete="name" autocapitalize="words"'))}
    </div>`;
  }
  if (step === 1) {
    return `<div class="card"><h2>Summary of work performed</h2>
      ${ta("summary", r.summary, "Track work, surfacing, tie replacement, welding…")}
    </div>
    <div class="card"><h2>Delays / interruptions</h2>
      ${ta("delays", r.delays, "Train traffic, weather, waiting on materials…")}
    </div>`;
  }
  if (step === 2) {
    return materialBlock("Received and accounted materials", "received", r.received, true)
      + materialBlock("Materials consumed", "consumed", r.consumed, false);
  }
  if (step === 3) {
    const rec = (store.settings.recentClasses || []).filter((c) => !PRESETS.includes(c));
    return `<div class="card"><h2>Manpower and equipment</h2>
      <p class="hint">Tap a common class, or Other to write in any equipment or extra machines.</p>
      <div class="chips">
        ${PRESETS.map((n) => `<button class="chip" data-preset="${esc(n)}">${esc(n)}</button>`).join("")}
        ${rec.map((n) => `<button class="chip recent" data-preset="${esc(n)}">${esc(n)}</button>`).join("")}
        <button class="chip other" data-act="other">Other</button>
      </div>
      ${r.manpower.map((row) => `<div class="item">
        <div class="item-top"><span class="muted">Class / equipment</span>
          <button class="btn btn-danger" style="width:auto;margin:0;padding:6px 10px;font-size:12px" data-rm="manpower" data-id="${row.id}">Remove</button></div>
        <input data-row="manpower" data-id="${row.id}" data-f="className" value="${esc(row.className)}" placeholder="Write in any class or equipment" autocapitalize="words" />
        <div class="row">
          ${field("QTY", `<input inputmode="decimal" data-row="manpower" data-id="${row.id}" data-f="qty" value="${esc(row.qty)}" />`)}
          ${field("Hours", `<input inputmode="decimal" data-row="manpower" data-id="${row.id}" data-f="hours" value="${esc(row.hours)}" />`)}
        </div>
      </div>`).join("")}
      <button class="btn btn-ghost" data-add="manpower">Add another class / equipment</button>
    </div>
    <div class="card"><h2>Subcontractors</h2>
      ${r.subcontractors.map((row) => `<div class="item">
        <div class="item-top"><span class="muted">Subcontractor</span>
          <button class="btn btn-danger" style="width:auto;margin:0;padding:6px 10px;font-size:12px" data-rm="subcontractors" data-id="${row.id}">Remove</button></div>
        <input data-row="subcontractors" data-id="${row.id}" data-f="description" value="${esc(row.description)}" placeholder="Company or crew" />
        <div class="row">
          ${field("Hours", `<input inputmode="decimal" data-row="subcontractors" data-id="${row.id}" data-f="hours" value="${esc(row.hours)}" />`)}
        </div>
        ${field("Details", `<input data-row="subcontractors" data-id="${row.id}" data-f="details" value="${esc(row.details)}" placeholder="Work performed" />`)}
      </div>`).join("")}
      <button class="btn btn-ghost" data-add="subcontractors">Add subcontractor</button>
    </div>`;
  }
  if (step === 4) {
    return ynCard("Any incidents today?", "incidents", r.incidents, "incidentsExplain", r.incidentsExplain)
      + ynCard("Any equipment issues today?", "equipmentIssues", r.equipmentIssues, "equipmentIssuesExplain", r.equipmentIssuesExplain)
      + `<div class="card"><h2>Before leaving the site</h2>
          ${ynRow("Site secure before leaving", "siteSecure", r.siteSecure)}
          ${ynRow("Derails down", "derailsDown", r.derailsDown)}
          ${ynRow("All locks removed", "locksRemoved", r.locksRemoved)}
        </div>`;
  }
  if (step === 5) {
    return `<div class="card"><h2>Job photos</h2>
      <p class="hint">Add 3–4 photos. Take a new one or pick from your camera roll, then add a short note on each.</p>
      <div class="nav" style="margin:0 0 12px">
        <button class="btn btn-navy" data-act="photo" style="margin:0">Take photo</button>
        <button class="btn btn-outline" data-act="library" style="margin:0">From library</button>
      </div>
      <input id="photoFile" type="file" accept="image/*" capture="environment" hidden />
      <input id="libraryFile" type="file" accept="image/*" multiple hidden />
      ${r.photos.map((p, i) => `<div class="item">
        <img src="${p.dataUrl}" alt="Photo ${i + 1}" style="width:100%;aspect-ratio:4/3;object-fit:cover;border-radius:10px;background:#ddd" />
        <label>Photo ${i + 1} notes</label>
        <input data-caption="${p.id}" value="${esc(p.caption || "")}" placeholder="What does this show?" />
        <button class="btn btn-danger" data-rmphoto="${p.id}">Remove</button>
      </div>`).join("") || `<p class="empty">No photos yet.</p>`}
    </div>`;
  }
  return `<div class="card"><h2>Sign and send</h2>
      ${field("Print name", input("printName", r.printName, 'placeholder="Your name"'))}
      ${field("PDF file name", `<input data-k="pdfTitle" value="${esc(r.pdfTitle || autoTitle(r))}" placeholder="25125- 260913 Matt" />`)}
      <p class="hint">Office format is project- YYMMDD firstname, like 25125- 260913 Matt. Edit if you need Matt instead of Matthew.</p>
      ${field("Email to", `<input type="email" data-k="recipientEmail" value="${esc(r.recipientEmail)}" />`)}
      <p class="hint">This goes out with the report to ${DEFAULT_EMAIL}</p>
      <label>Signature</label>
      <canvas class="sig" id="sig"></canvas>
      <button class="btn btn-ghost" data-act="clearsig">Clear signature</button>
    </div>
    <div class="card">
      <p class="hint">Share the PDF (and photos) to Mail so it lands at the office. On iPhone use the Mail app, not a browser tab.</p>
      <button class="btn btn-gold" data-act="send">Share PDF + photos</button>
      <button class="btn btn-ghost" data-act="pdf">Download PDF only</button>
    </div>`;
}

function recentChips() {
  const rec = store.settings.recentProjects || [];
  if (!rec.length) return "";
  return `<div class="chips">${rec.map((p) => `<button class="chip" data-proj="${esc(p)}">${esc(p)}</button>`).join("")}</div>`;
}
function ynCard(title, key, val, explainKey, explain) {
  return `<div class="card"><h2>${title}</h2>
    ${ynRow("", key, val)}
    ${val === "yes" ? field("Explain", ta(explainKey, explain, "What happened")) : ""}
  </div>`;
}
function ynRow(label, key, val) {
  return `${label ? `<label>${label}</label>` : ""}<div class="yn">
    <button data-yn="${key}" data-v="yes" class="${val === "yes" ? "on-yes" : ""}">Yes</button>
    <button data-yn="${key}" data-v="no" class="${val === "no" ? "on-no" : ""}">No</button>
  </div>`;
}

function materialBlock(title, key, rows, bol) {
  return `<div class="card"><h2>${title}</h2>
    ${rows.map((row) => `<div class="item">
      <div class="item-top"><span class="muted">Item</span>
        <button class="btn btn-danger" style="width:auto;margin:0;padding:6px 10px;font-size:12px" data-rm="${key}" data-id="${row.id}">Remove</button></div>
      <input data-row="${key}" data-id="${row.id}" data-f="description" value="${esc(row.description)}" placeholder="Description" />
      <div class="row">
        ${field("QTY", `<input inputmode="decimal" data-row="${key}" data-id="${row.id}" data-f="qty" value="${esc(row.qty)}" />`)}
        ${bol ? field("BOL filed", `<select data-row="${key}" data-id="${row.id}" data-f="bolFiled">
            <option value="" ${row.bolFiled === "" ? "selected" : ""}></option>
            <option value="yes" ${row.bolFiled === "yes" ? "selected" : ""}>Yes</option>
            <option value="no" ${row.bolFiled === "no" ? "selected" : ""}>No</option>
          </select>`) : ""}
      </div>
    </div>`).join("")}
    <button class="btn btn-ghost" data-add="${key}">Add item</button>
  </div>`;
}

function bind() {
  document.querySelectorAll("[data-act]").forEach((b) => b.addEventListener("click", onAct));
  document.querySelectorAll("[data-open]").forEach((el) => el.addEventListener("click", (e) => {
    if (e.target.closest("[data-del]")) return;
    openReport(el.getAttribute("data-open"));
  }));
  document.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", (e) => {
    e.stopPropagation();
    const id = b.getAttribute("data-del");
    delete store.reports[id];
    store.order = store.order.filter((x) => x !== id);
    save();
    render();
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
    r[key] = [...r[key], maker()];
    save();
    render();
    if (key === "manpower") {
      const inputs = [...document.querySelectorAll('[data-row="manpower"][data-f="className"]')];
      const last = inputs[inputs.length - 1];
      last?.focus();
    }
  }));
  document.querySelectorAll("[data-rm]").forEach((b) => b.addEventListener("click", () => {
    const key = b.getAttribute("data-rm");
    const id = b.getAttribute("data-id");
    const r = active();
    r[key] = r[key].length <= 1 ? r[key].map((row) => row.id === id ? (key === "manpower" ? emptyRow.manpower() : key === "subcontractors" ? emptyRow.sub() : key === "consumed" ? emptyRow.consumed() : emptyRow.received()) : row) : r[key].filter((row) => row.id !== id);
    save();
    render();
  }));
  document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => addPreset(b.getAttribute("data-preset"))));
  document.querySelectorAll("[data-proj]").forEach((b) => b.addEventListener("click", () => {
    patch({ projectNumber: b.getAttribute("data-proj") });
    render();
  }));
  document.querySelectorAll("[data-yn]").forEach((b) => b.addEventListener("click", () => {
    patch({ [b.getAttribute("data-yn")]: b.getAttribute("data-v") });
    render();
  }));
  document.querySelectorAll("[data-rmphoto]").forEach((b) => b.addEventListener("click", () => {
    const r = active();
    r.photos = r.photos.filter((p) => p.id !== b.getAttribute("data-rmphoto"));
    patch({ photos: r.photos });
    render();
  }));
  if (step === 6) setupSig();
  const cam = document.getElementById("photoFile");
  const lib = document.getElementById("libraryFile");
  if (cam) cam.addEventListener("change", onPhoto);
  if (lib) lib.addEventListener("change", onPhoto);
}

function onAct(e) {
  const act = e.currentTarget.getAttribute("data-act");
  if (act === "start") start(false);
  if (act === "fromlast") start(true);
  if (act === "home") { screen = "home"; activeId = null; step = 0; render(); }
  if (act === "back") { step = Math.max(0, step - 1); render(); }
  if (act === "next") {
    if (!canNext()) return;
    step += 1;
    render();
  }
  if (act === "other") addWriteIn();
  if (act === "photo") document.getElementById("photoFile")?.click();
  if (act === "library") document.getElementById("libraryFile")?.click();
  if (act === "clearsig") {
    patch({ signatureDataUrl: "" });
    setupSig(true);
  }
  if (act === "pdf") downloadPdf();
  if (act === "send") sendReport();
}

function canNext() {
  const r = active();
  if (step === 0) {
    if (!r.projectNumber.trim() || !r.printName.trim()) {
      toast("Project number and name are required.");
      return false;
    }
  }
  if (step === 1 && !r.summary.trim()) {
    toast("Add a short summary of the work.");
    return false;
  }
  return true;
}

function start(fromLast) {
  const items = list();
  const today = todayISO();
  if (!fromLast) {
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
        ? last.manpower.map((row) => ({ ...emptyRow.manpower(), className: row.className, qty: row.qty }))
        : [emptyRow.manpower()];
    }
  }
  store.reports[r.id] = r;
  store.order.unshift(r.id);
  save();
  openReport(r.id);
}

function openReport(id) {
  activeId = id;
  screen = "wizard";
  step = 0;
  render();
}

function addPreset(name) {
  const r = active();
  const blank = r.manpower.find((row) => !row.className.trim());
  if (blank) blank.className = name;
  else r.manpower.push({ ...emptyRow.manpower(), className: name });
  save();
  render();
}
function addWriteIn() {
  const r = active();
  if (!r.manpower.find((row) => !row.className.trim())) r.manpower.push(emptyRow.manpower());
  save();
  render();
  const inputs = [...document.querySelectorAll('[data-row="manpower"][data-f="className"]')];
  const empty = inputs.find((el) => !el.value.trim()) || inputs[inputs.length - 1];
  empty?.focus();
}

async function onPhoto(e) {
  const files = [...(e.target.files || [])];
  e.target.value = "";
  if (!files.length) return;
  const r = active();
  for (const file of files) {
    if (!file.type || !file.type.startsWith("image/")) continue;
    const dataUrl = await compressImage(file);
    r.photos.push({ id: uid(), dataUrl, caption: "", takenAt: new Date().toISOString() });
  }
  save();
  render();
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const max = 1280;
      let { width, height } = img;
      if (width > max || height > max) {
        const s = Math.min(max / width, max / height);
        width = Math.round(width * s);
        height = Math.round(height * s);
      }
      const c = document.createElement("canvas");
      c.width = width; c.height = height;
      c.getContext("2d").drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", 0.72));
    };
    img.onerror = reject;
    img.src = url;
  });
}

function setupSig(clear) {
  const canvas = document.getElementById("sig");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const r = active();
  const resize = () => {
    const w = canvas.clientWidth;
    const h = canvas.clientHeight;
    canvas.width = w * 2;
    canvas.height = h * 2;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.lineWidth = 2.2;
    ctx.lineCap = "round";
    ctx.strokeStyle = "#142033";
    if (r.signatureDataUrl && !clear) {
      const im = new Image();
      im.onload = () => ctx.drawImage(im, 0, 0, w, h);
      im.src = r.signatureDataUrl;
    }
  };
  resize();
  let drawing = false;
  const pos = (ev) => {
    const rect = canvas.getBoundingClientRect();
    const t = ev.touches ? ev.touches[0] : ev;
    return { x: t.clientX - rect.left, y: t.clientY - rect.top };
  };
  const start = (ev) => { ev.preventDefault(); drawing = true; const p = pos(ev); ctx.beginPath(); ctx.moveTo(p.x, p.y); };
  const move = (ev) => { if (!drawing) return; ev.preventDefault(); const p = pos(ev); ctx.lineTo(p.x, p.y); ctx.stroke(); };
  const end = () => {
    if (!drawing) return;
    drawing = false;
    patch({ signatureDataUrl: canvas.toDataURL("image/png") });
  };
  canvas.addEventListener("pointerdown", start);
  canvas.addEventListener("pointermove", move);
  window.addEventListener("pointerup", end);
}

function yn(v) { return v === "yes" ? "YES" : v === "no" ? "NO" : "—"; }

function reportText(r) {
  const rec = r.received.filter((x) => x.description.trim()).map((x) => `  • ${x.description}  qty ${x.qty || "—"}  BOL ${yn(x.bolFiled)}`).join("\n");
  const con = r.consumed.filter((x) => x.description.trim()).map((x) => `  • ${x.description}  qty ${x.qty || "—"}`).join("\n");
  const crew = r.manpower.filter((x) => x.className.trim()).map((x) => `  • ${x.className}  qty ${x.qty || "—"}  hrs ${x.hours || "—"}`).join("\n");
  const subs = r.subcontractors.filter((x) => x.description.trim()).map((x) => `  • ${x.description}  hrs ${x.hours || "—"}${x.details ? "\n    " + x.details : ""}`).join("\n");
  return [
    "STX CORPORATION — DAILY PROJECT SUMMARY",
    `Date: ${formatLong(r.date) || r.date}`,
    `Project #: ${r.projectNumber || "—"}`,
    `Supervisor: ${r.printName || "—"}`,
    "", "SUMMARY OF WORK PERFORMED", r.summary.trim() || "—",
    "", "DELAYS / INTERRUPTIONS", r.delays.trim() || "None",
    "", "RECEIVED AND ACCOUNTED MATERIALS", rec || "  (none)",
    "", "MATERIALS CONSUMED", con || "  (none)",
    "", "MANPOWER AND EQUIPMENT", crew || "  (none)",
    "", "SUBCONTRACTORS", subs || "  (none)",
    "", `Any incidents today: ${yn(r.incidents)}`, r.incidents === "yes" ? r.incidentsExplain : "",
    `Any equipment issues today: ${yn(r.equipmentIssues)}`, r.equipmentIssues === "yes" ? r.equipmentIssuesExplain : "",
    `Site secure before leaving: ${yn(r.siteSecure)}`,
    `Derails down: ${yn(r.derailsDown)}`,
    `All locks removed: ${yn(r.locksRemoved)}`,
    "", `Job photos: ${r.photos.length}`,
    "", `Print name: ${r.printName || "—"}`,
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

function buildPdf(r) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "pt", format: "letter" });
  const NAVY = [12, 35, 64];
  const INK = [20, 32, 51];
  const MUTED = [92, 101, 112];
  const LINE = [196, 188, 168];
  const HEAD = [232, 226, 212];
  const pageW = 612;
  const pageH = 792;
  const margin = 40;
  const contentW = pageW - margin * 2;
  let y = 0;

  const ensure = (need) => {
    if (y + need > pageH - 48) {
      doc.addPage();
      y = 40;
    }
  };

  doc.setFillColor(...NAVY);
  doc.rect(0, 0, pageW, 72, "F");
  doc.setFillColor(196, 154, 54);
  doc.rect(0, 72, pageW, 3, "F");
  doc.setFillColor(255, 252, 245);
  doc.triangle(42, 16, 64, 56, 20, 56, "F");
  doc.setFillColor(...NAVY);
  doc.triangle(42, 26, 56, 52, 28, 52, "F");
  doc.setTextColor(255, 252, 245);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(20);
  doc.text("STX", 74, 34);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text("CORPORATION  ·  RAILROAD CONSTRUCTION SERVICES", 74, 48);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text("DAILY PROJECT SUMMARY", pageW - margin, 32, { align: "right" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(formatLong(r.date) || r.date, pageW - margin, 46, { align: "right" });
  doc.text("Project # " + (r.projectNumber || "—"), pageW - margin, 58, { align: "right" });

  y = 84;
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(...MUTED);
  doc.text("SUPERVISOR", margin, y);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.setTextColor(...INK);
  doc.text(r.printName || "—", margin + 90, y);
  y = 96;

  const section = (title) => {
    y += 4;
    ensure(28);
    doc.setFillColor(...NAVY);
    doc.rect(margin, y, contentW, 18, "F");
    doc.setTextColor(255, 252, 245);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(String(title).toUpperCase(), margin + 8, y + 12);
    doc.setTextColor(...INK);
    y += 18;
  };

  const para = (text, minH) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const lines = doc.splitTextToSize(String(text || "—"), contentW - 16);
    const h = Math.max(minH || 22, lines.length * 12 + 12);
    ensure(h);
    doc.text(lines, margin + 8, y + 12);
    y += h;
  };

  const kvRow = (label, value) => {
    ensure(18);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...MUTED);
    doc.text(label, margin + 8, y + 12);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(String(value || "—"), margin + 130, y + 12);
    y += 16;
  };

  const table = (headers, rows, widths) => {
    const body = rows.length ? rows : [headers.map(() => "—")];
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.4);
    body.forEach((row) => {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9);
      const wrapped = headers.map((_, i) => doc.splitTextToSize(String(row[i] ?? ""), (widths[i] || 80) - 10));
      const h = Math.max(16, Math.max(...wrapped.map((ln) => ln.length)) * 11 + 6);
      ensure(h + 4);
      let x = margin;
      headers.forEach((_, i) => {
        const w = widths[i];
        doc.rect(x, y, w, h);
        doc.text(wrapped[i], x + 5, y + 12);
        x += w;
      });
      y += h;
    });
    y += 4;
  };

  const tableHead = (headers, widths) => {
    ensure(20);
    doc.setFillColor(...HEAD);
    doc.rect(margin, y, contentW, 16, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...INK);
    let x = margin;
    headers.forEach((h, i) => {
      doc.text(h, x + 5, y + 11);
      x += widths[i];
    });
    y += 16;
  };

  section("Summary of work performed");
  para(r.summary, 36);

  section("Delays / interruptions");
  para(r.delays || "None", 22);

  const rec = (r.received || []).filter((x) => String(x.description || "").trim());
  section("Received and accounted materials");
  tableHead(["Description", "QTY", "BOL filed"], [340, 80, 112]);
  table(["Description", "QTY", "BOL"], rec.map((x) => [x.description, x.qty || "—", yn(x.bolFiled)]), [340, 80, 112]);

  const con = (r.consumed || []).filter((x) => String(x.description || "").trim());
  section("Materials consumed");
  tableHead(["Description", "QTY"], [420, 112]);
  table(["Description", "QTY"], con.map((x) => [x.description, x.qty || "—"]), [420, 112]);

  const crew = (r.manpower || []).filter((x) => String(x.className || "").trim());
  section("Manpower and equipment");
  tableHead(["Class / equipment", "QTY", "Hours"], [332, 100, 100]);
  table(["Class", "QTY", "Hours"], crew.map((x) => [x.className, x.qty || "—", x.hours || "—"]), [332, 100, 100]);

  const subs = (r.subcontractors || []).filter((x) => String(x.description || "").trim());
  section("Subcontractors");
  tableHead(["Description", "Hours"], [432, 100]);
  table(["Description", "Hours"], subs.length ? subs.map((x) => [x.description + (x.details ? " — " + x.details : ""), x.hours || "—"]) : [["None", ""]], [432, 100]);

  section("Closeout");
  kvRow("Incidents", yn(r.incidents));
  if (r.incidents === "yes" && r.incidentsExplain) para(r.incidentsExplain, 24);
  kvRow("Equipment issues", yn(r.equipmentIssues));
  if (r.equipmentIssues === "yes" && r.equipmentIssuesExplain) para(r.equipmentIssuesExplain, 24);
  kvRow("Site secure", yn(r.siteSecure));
  kvRow("Derails down", yn(r.derailsDown));
  kvRow("Locks removed", yn(r.locksRemoved));

  y += 8;
  ensure(62);
  doc.setDrawColor(...LINE);
  doc.setLineWidth(0.7);
  doc.line(margin, y + 40, margin + 200, y + 40);
  doc.line(margin + 240, y + 40, margin + contentW, y + 40);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(...MUTED);
  doc.text("PRINT NAME", margin, y + 52);
  doc.text("SIGNATURE", margin + 240, y + 52);
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(11);
  doc.text(r.printName || " ", margin, y + 34);
  if (r.signatureDataUrl) {
    try { doc.addImage(r.signatureDataUrl, "PNG", margin + 240, y - 8, 180, 46); } catch (e) {}
  }
  y += 64;

  if ((r.photos || []).length) {
    doc.addPage();
    y = 40;
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageW, 44, "F");
    doc.setTextColor(255, 252, 245);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);
    doc.text("Job photos", margin, 28);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Project # " + (r.projectNumber || "—") + "  ·  " + (formatLong(r.date) || r.date), pageW - margin, 28, { align: "right" });
    y = 60;
    doc.setTextColor(...INK);
    r.photos.forEach((p, i) => {
      const note = String(p.caption || "").trim() || ("Photo " + (i + 1));
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      const noteLines = doc.splitTextToSize((i + 1) + ".  " + note, contentW);
      const noteH = noteLines.length * 13 + 8;
      ensure(noteH + 220);
      doc.text(noteLines, margin, y + 12);
      y += noteH;
      if (p.dataUrl) {
        try {
          doc.addImage(p.dataUrl, "JPEG", margin, y, contentW, 168, undefined, "FAST");
          y += 176;
        } catch (e) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9);
          doc.text("(photo could not be embedded)", margin, y + 14);
          y += 24;
        }
      }
      y += 8;
    });
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i += 1) {
    doc.setPage(i);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
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
  if (!window.jspdf) { toast("PDF library still loading — try again."); return; }
  downloadBlob(buildPdf(r), fileName(r));
  toast("PDF saved.");
}

async function sendReport() {
  const r = active();
  if (!r.printName.trim() || !r.signatureDataUrl) {
    toast("Print name and signature are required.");
    return;
  }
  if (!window.jspdf) { toast("PDF library still loading — try again."); return; }
  const pdf = buildPdf(r);
  const pdfFile = new File([pdf], fileName(r), { type: "application/pdf" });
  const photoFiles = r.photos.map((p, i) => dataUrlFile(p.dataUrl, `job-photo-${i + 1}.jpg`));
  const files = [pdfFile, ...photoFiles];

  const custom = r.manpower.map((x) => x.className.trim()).filter((n) => n && !PRESETS.includes(n));
  store.settings.recentClasses = [...custom, ...(store.settings.recentClasses || []).filter((c) => !custom.includes(c))].slice(0, 12);
  const project = r.projectNumber.trim();
  if (project) store.settings.recentProjects = [project, ...store.settings.recentProjects.filter((p) => p !== project)].slice(0, 8);
  store.settings.defaultName = r.printName.trim() || store.settings.defaultName;
  store.settings.defaultEmail = r.recipientEmail.trim() || DEFAULT_EMAIL;
  store.settings.lastProject = project || store.settings.lastProject;

  const markSent = () => {
    r.status = "sent";
    r.sentAt = new Date().toISOString();
    save();
    toast("Marked sent.");
    screen = "home";
    activeId = null;
    step = 0;
    render();
  };

  try {
    if (navigator.share && navigator.canShare && navigator.canShare({ files })) {
      await navigator.share({
        title: `Daily Project Summary — ${r.projectNumber || "Project"} — ${r.date}`,
        text: `Daily Project Summary for project ${r.projectNumber || "—"} on ${r.date}. Please send to ${r.recipientEmail}.`,
        files,
      });
      markSent();
      return;
    }
  } catch (err) {
    if (err && err.name === "AbortError") return;
  }
  downloadBlob(pdf, fileName(r));
  const subject = encodeURIComponent(`Daily Project Summary — ${r.projectNumber || "Project"} — ${r.date}`);
  const body = encodeURIComponent(reportText(r) + "\n\n---\nAttach the downloaded PDF and job photos before sending.");
  window.location.href = `mailto:${encodeURIComponent(r.recipientEmail)}?subject=${subject}&body=${body}`;
  markSent();
}

function dataUrlFile(dataUrl, name) {
  const [meta, b64] = dataUrl.split(",");
  const mime = (meta.match(/data:(.*?);/) || [])[1] || "image/jpeg";
  const bin = atob(b64 || "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new File([bytes], name, { type: mime });
}

try {
  load();
  render();
} catch (err) {
  const el = document.getElementById("app");
  if (el) el.innerHTML = "<header class=\"hero\"><h1>STX Daily</h1></header><main class=\"content\"><div class=\"card\"><p>Could not load the report app. Close Safari and open the link again.</p><p class=\"hint\">" + String(err) + "</p></div></main>";
  console.error(err);
}
