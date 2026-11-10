import * as St from "./store.js";
import { CALIBERS, COINS, measureGroup, analyze as analyzeHere } from "./engine.js";
import * as RF from "./rosterfmt.js";

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (v, d = 3) => (v == null || !isFinite(v) ? "–" : Number(v).toFixed(d));
const LETTERS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

St.load();
// A shared event link (?event=…) opens the app on that event.
const linkEvent = new URLSearchParams(location.search).get("event");
if (linkEvent) { try { St.setSetting("pendingEvent", linkEvent); history.replaceState(null, "", location.pathname); } catch {} }
const cfg = window.RATA_CONFIG || {};
if (cfg.syncUrl && !St.settings().syncUrl) St.setSetting("syncUrl", cfg.syncUrl);

const SHEETS = [
  { id: "letter", label: "Letter 8.5 × 11 in", w: 8.5, h: 11 },
  { id: "legal", label: "Legal 8.5 × 14 in", w: 8.5, h: 14 },
  { id: "a17", label: "NRA A-17 10.5 × 12 in", w: 10.5, h: 12 },
  { id: "custom", label: "Other size (enter it)" },
  { id: "none", label: "Not sure / odd shape" },
];

const S = {
  tab: St.listEvents().length ? "score" : "events",
  disciplineId: null,
  personId: null,
  search: "",
  editEvent: null,
  pasteOpen: false,
  a: null, // the target being measured
  syncState: "",
};

// ------------------------------------------------------------------ helpers

function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(toast.t);
  toast.t = setTimeout(() => t.classList.remove("show"), 2600);
}
const eventLink = (ev) => `${location.origin}${location.pathname}?event=${encodeURIComponent(ev.id)}`;
const activeEvent = () => St.data().events[St.settings().activeEvent] || null;
// New phones start on today's event (or the most recent one) instead of an empty screen.
function ensureEvent() {
  const want = St.settings().pendingEvent;
  if (want && St.data().events[want] && !St.data().events[want].deleted) {
    St.setSetting("activeEvent", want); St.setSetting("pendingEvent", null);
    if (S.tab === "events" && !S.editEvent) S.tab = "score";
    return;
  }
  const cur = activeEvent();
  if (cur && !cur.deleted) return;
  const evs = St.listEvents();
  if (!evs.length) return;
  const today = new Date().toLocaleDateString("en-CA");
  St.setSetting("activeEvent", (evs.find((e) => e.date === today) || evs[0]).id);
}
function disciplinesOn(ev) { return (ev?.disciplines || []).filter((d) => d.on); }
function currentDiscipline() {
  const ev = activeEvent();
  const on = disciplinesOn(ev);
  let d = on.find((x) => x.id === S.disciplineId);
  if (!d) { d = on[0] || null; S.disciplineId = d?.id || null; }
  return d;
}
function caliberOf(id) { return CALIBERS.find((c) => c.id === id) || CALIBERS[0]; }
// Hole size correction comes from the site (config.js) so every phone measures the same.
function holeFactor(id) { const f = Number(cfg.holeFactor?.[id]); return f > 0.5 && f < 1.5 ? f : 1; }
function sheetChoice() {
  const s = St.settings().sheet || { id: "letter" };
  if (s.id === "custom") return { id: "custom", w: Number(s.w) || 0, h: Number(s.h) || 0 };
  const p = SHEETS.find((x) => x.id === s.id) || SHEETS[0];
  return { id: p.id, w: p.w || 0, h: p.h || 0 };
}
const person = (id) => St.data().people[id];
// Two-tap confirm: the first tap arms the button, a second tap within 3 seconds does it.
function confirmTap(el, label) {
  if (el.dataset.armed === "1") return true;
  const old = el.innerHTML;
  el.dataset.armed = "1"; el.innerHTML = label; el.classList.add("armed");
  setTimeout(() => { if (el.isConnected && el.dataset.armed === "1") { el.dataset.armed = ""; el.innerHTML = old; el.classList.remove("armed"); } }, 3000);
  return false;
}

// ------------------------------------------------------------------ icons

const ICON = {
  events: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="17" rx="2"/><path d="M3 9h18M8 2v4M16 2v4"/></svg>',
  score: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/></svg>',
  results: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 21V11M16 21V7M12 21V3M4 21h16"/></svg>',
  settings: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
};

function renderTabs() {
  const tabs = [["events", "Events"], ["score", "Score"], ["results", "Results"], ["settings", "Settings"]];
  $("#tabs").innerHTML = tabs.map(([k, l]) => `<button data-tab="${k}" class="${S.tab === k ? "on" : ""}">${ICON[k]}<span>${l}</span></button>`).join("");
}

// ------------------------------------------------------------------ render

function render() {
  ensureEvent();
  renderTabs();
  renderSync();
  const v = $("#view");
  if (S.tab === "events") v.innerHTML = viewEvents();
  else if (S.tab === "score") v.innerHTML = viewScore();
  else if (S.tab === "results") v.innerHTML = viewResults();
  else v.innerHTML = viewSettings();
  afterRender();
}

function renderSync() {
  const b = $("#syncBtn");
  const n = St.pendingCount();
  const hasUrl = !!St.settings().syncUrl;
  b.className = "sync";
  if (!hasUrl) { b.textContent = "This phone only"; return; }
  if (S.syncState === "busy") { b.textContent = "Syncing…"; return; }
  if (n) { b.textContent = `${n} to send`; b.classList.add("pending"); return; }
  if (S.syncState === "offline") { b.textContent = "No signal"; return; }
  b.textContent = "Synced"; b.classList.add("ok");
}

// ---------------- events

function viewEvents() {
  if (S.editEvent) return viewEventForm(S.editEvent);
  const evs = St.listEvents();
  const act = activeEvent();
  let h = `<h1>Events</h1>`;
  if (!evs.length) h += `<div class="card soft"><p>Start by making an event. Add the scouts or patrols, then score.</p></div>`;
  h += `<div class="card"><ul class="list">${evs.map((e) => `
    <li><div class="grow"><div class="name">${esc(e.name)}</div><div class="small muted">${esc(e.date || "")}${e.location ? " · " + esc(e.location) : ""}</div></div>
    ${act && act.id === e.id ? '<span class="chip on">Current</span>' : `<button class="btn slim" data-act="useEvent" data-id="${e.id}">Use</button>`}
    <button class="btn slim" data-act="editEvent" data-id="${e.id}">Edit</button></li>`).join("") || '<li class="muted">No events yet.</li>'}</ul>
    <div class="btns" style="margin-top:10px"><button class="btn primary" data-act="newEvent">New event</button></div></div>`;
  h += viewImport(act);
  if (act) h += viewSchedule(act) + viewRoster(act) + viewShare(act);
  return h;
}

function viewEventForm(ev) {
  const ds = ev.disciplines;
  return `<h1>${ev.id ? "Edit event" : "New event"}</h1>
  <div class="card">
    <label class="f"><span>Event name</span><input type="text" id="evName" value="${esc(ev.name || "")}" placeholder="e.g. Fall Camporee 2026"></label>
    <div class="row">
      <label class="f"><span>Date</span><input type="date" id="evDate" value="${esc(ev.date || "")}"></label>
      <label class="f"><span>Shots per group</span><input type="number" id="evShots" min="1" max="20" value="${ev.shotsPerGroup || 5}"></label>
    </div>
    <label class="f"><span>Location</span><input type="text" id="evLoc" value="${esc(ev.location || "")}" placeholder="e.g. Knox Scout Reservation"></label>
    <label class="f"><span>Type of event</span><select id="evKind">
      <option value="camporee" ${ev.kind !== "merit" ? "selected" : ""}>Camporee: patrols ranked against each other</option>
      <option value="merit" ${ev.kind === "merit" ? "selected" : ""}>Merit badge class: each scout on their own</option></select></label>
  </div>
  <div class="card"><h2>What's being scored</h2>
    ${ds.map((d, i) => `
      <div class="card soft" style="margin-bottom:10px">
        <label style="display:flex;align-items:center;gap:10px;font-weight:700"><input type="checkbox" data-d="${i}" data-k="on" ${d.on ? "checked" : ""} style="width:22px;height:22px">
          <input type="text" data-d="${i}" data-k="name" value="${esc(d.name)}" style="min-height:40px"></label>
        <div class="row" style="margin-top:8px">
        ${d.kind === "group"
          ? `<label class="f"><span>Caliber</span><select data-d="${i}" data-k="caliberId">${CALIBERS.map((c) => `<option value="${c.id}" ${c.id === d.caliberId ? "selected" : ""}>${c.label}</option>`).join("")}</select></label>
             <label class="f"><span>If a participant has several groups</span><select data-d="${i}" data-k="rule"><option value="best" ${d.rule === "best" ? "selected" : ""}>Use the smallest</option><option value="average" ${d.rule === "average" ? "selected" : ""}>Average them</option></select></label>`
          : `<label class="f"><span>Top possible score</span><input type="number" data-d="${i}" data-k="max" value="${d.max || ""}" min="1"></label>
             <label class="f"><span>If a participant has several scores</span><select data-d="${i}" data-k="rule"><option value="total" ${d.rule === "total" ? "selected" : ""}>Add them up</option><option value="best" ${d.rule === "best" ? "selected" : ""}>Use the highest</option><option value="average" ${d.rule === "average" ? "selected" : ""}>Average them</option></select></label>`}
        </div>
        <div class="small muted">${d.kind === "group" ? "Scored from a photo of the target. Smaller groups rank higher." : "Instructor types in the score. Higher ranks higher."}</div>
      </div>`).join("")}
  </div>
  <div class="btns"><button class="btn primary big" data-act="saveEvent">Save event</button><button class="btn big" data-act="cancelEvent">Cancel</button></div>`;
}

// ---------------- organizer sheet

const ORGANIZER_URL = () => new URL("organizer.html", location.href).href;

function viewImport(act) {
  const im = S.imp;
  let h = `<div class="card"><h2>Load the organizer's sheet</h2>`;
  if (!im) {
    h += `<p class="small muted">The event organizer fills in the patrols, participants and report times, then sends a sheet of QR codes or the Excel file. Load it here instead of typing it all in.</p>
      <label class="btn primary block">Scan the QR codes<input type="file" accept="image/*" capture="environment" id="qrIn" class="hide"></label>
      <label class="btn block" style="margin-top:8px">Open the Excel file<input type="file" accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel" id="xlsIn" class="hide"></label>
      <p class="small muted" style="margin-top:10px">Send organizers this form: <span id="orgLink" style="word-break:break-all">${esc(ORGANIZER_URL())}</span> <button class="btn slim" data-act="copyOrg">Copy</button></p>`;
  } else if (im.busy) {
    h += `<div class="spinner"></div><p style="text-align:center">Reading…</p>`;
  } else if (im.error) {
    h += `<div class="note warn">${esc(im.error)}${im.total ? ` You have ${im.have.length} of ${im.total} codes so far.` : ""}</div><div class="btns"><label class="btn primary">${im.total ? `Scan code ${im.missing[0]}` : "Try again"}<input type="file" accept="image/*" capture="environment" id="qrIn" class="hide"></label><button class="btn" data-act="cancelImport">Cancel</button></div>`;
  } else if (!im.payload) {
    h += `<div class="note info">Got code${im.have.length === 1 ? "" : "s"} ${im.have.join(", ")} of ${im.total}. Take a photo of code ${im.missing[0]} next.</div>
      <div class="btns"><label class="btn primary">Scan code ${im.missing[0]}<input type="file" accept="image/*" capture="environment" id="qrIn" class="hide"></label><button class="btn" data-act="cancelImport">Cancel</button></div>`;
  } else {
    const pl = im.payload;
    const n = pl.kind === "merit" ? pl.scouts.length : pl.patrols.reduce((t, x) => t + (x.count || 0), 0);
    h += `<p><b>${esc(pl.name || "Untitled event")}</b>${pl.date ? " · " + esc(pl.date) : ""}${pl.location ? " · " + esc(pl.location) : ""}</p>
      <p class="small">${pl.kind === "merit" ? `Merit badge class · ${pl.scouts.length} scouts` : `Camporee · ${pl.patrols.length} patrols · ${n} participants${pl.ranges.length ? " · report times for " + pl.ranges.map((r) => RF.RANGES.find((x) => x.id === r)?.name || r).join(", ") : ""}`}</p>
      <div class="btns">
        ${act ? `<button class="btn primary" data-act="applyImport" data-into="${act.id}">Add to ${esc(act.name)}</button>` : ""}
        <button class="btn ${act ? "" : "primary"}" data-act="applyImport" data-into="">Make it a new event</button>
        <button class="btn" data-act="cancelImport">Cancel</button></div>`;
  }
  return h + `</div>`;
}

function viewSchedule(ev) {
  const sch = ev.schedule || [];
  if (!sch.length) return "";
  const ranges = RF.RANGES.filter((r) => sch.some((x) => x.times && x.times[r.id]));
  const order = [...sch].sort((a, b) => (RF.minutes(a.times?.[ranges[0]?.id]) ?? 9999) - (RF.minutes(b.times?.[ranges[0]?.id]) ?? 9999));
  return `<div class="card"><h2>Report times</h2><div class="tableWrap"><table><thead><tr><th>Patrol</th>${ranges.map((r) => `<th class="num">${r.name}</th>`).join("")}</tr></thead><tbody>
    ${order.map((x) => `<tr><td>${esc(St.team(x))}</td>${ranges.map((r) => `<td class="num">${esc(x.times?.[r.id] ? RF.clock(x.times[r.id]) : "–")}</td>`).join("")}</tr>`).join("")}
    </tbody></table></div></div>`;
}

async function readQrPhoto(file) {
  if (!window.jsQR) await loadScript("https://cdn.jsdelivr.net/npm/jsqr@1.4.0/dist/jsQR.js");
  const ph = await loadPhoto(file);
  // try a few sizes: small codes read better at full size, blurry ones smaller
  for (const edge of [1600, 1100, 2400, 800]) {
    const k = Math.min(1, edge / Math.max(ph.width, ph.height));
    const w = Math.round(ph.width * k), h = Math.round(ph.height * k);
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(ph.canvas, 0, 0, w, h);
    const r = window.jsQR(ctx.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: "dontInvert" });
    if (r && r.data) return r.data;
  }
  return null;
}

async function importQr(file) {
  // keep the codes already scanned, even if the last photo didn't read
  const prev = S.imp && S.imp.parts && !S.imp.payload ? S.imp : null;
  S.imp = { ...(prev || {}), busy: true };
  render();
  let raw;
  try { raw = await readQrPhoto(file); }
  catch { S.imp = { error: "The QR reader needs signal the first time it's used. Try again with signal." }; return render(); }
  const part = raw && RF.readPart(raw);
  if (!part) { S.imp = { ...(prev || {}), busy: false, error: raw ? "That QR code isn't an organizer sheet code." : "Couldn't read a QR code in that photo. Fill the screen with one code, hold steady, and try again." }; return render(); }
  const im = prev && prev.id === part.id ? prev : { id: part.id, total: part.total, parts: {} };
  im.parts[part.index] = part.text;
  im.have = Object.keys(im.parts).map(Number).sort((a, b) => a - b);
  im.missing = [];
  for (let i = 1; i <= im.total; i++) if (im.parts[i] == null) im.missing.push(i);
  im.busy = false; im.error = null;
  if (!im.missing.length) {
    try { im.payload = RF.joinParts(im.parts, im.total); }
    catch (e) { S.imp = { error: "Couldn't read the organizer sheet: " + e.message }; return render(); }
  }
  S.imp = im;
  render();
}

async function importXlsx(file) {
  S.imp = { busy: true };
  render();
  try {
    if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    const wb = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const sheets = {};
    wb.SheetNames.forEach((n) => { sheets[n] = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false, defval: "" }); });
    const pl = RF.fromSheets(sheets);
    if (!pl.patrols.length && !pl.scouts.length) throw new Error("No patrols or scouts found. Is this the organizer template?");
    S.imp = { payload: pl };
  } catch (e) {
    S.imp = { error: /signal|fetch|load/i.test(String(e)) ? "The Excel reader needs signal the first time it's used." : String(e.message || e) };
  }
  render();
}

function isoDate(d) {
  if (!d) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
  const t = new Date(d);
  return isNaN(t) ? "" : t.toLocaleDateString("en-CA");
}

function applyImport(pl, intoId) {
  let ev = intoId ? St.data().events[intoId] : null;
  const onFor = (id) => (pl.kind === "merit" ? id === "rifle" : pl.ranges.length ? pl.ranges.includes(id) : ["rifle", "shotgun", "archery"].includes(id));
  if (!ev) {
    ev = St.saveEvent({
      name: pl.name || "New event", date: isoDate(pl.date) || new Date().toLocaleDateString("en-CA"), location: pl.location || "",
      shotsPerGroup: 5, kind: pl.kind, schedule: [],
      disciplines: St.DEFAULT_DISCIPLINES.map((d) => ({ ...d, on: onFor(d.id) })),
    });
  } else {
    ev = { ...ev, kind: ev.kind || pl.kind, schedule: [...(ev.schedule || [])] };
    if (pl.kind === "camporee" && pl.ranges.length) ev.disciplines = (ev.disciplines || []).map((d) => ({ ...d, on: d.on || pl.ranges.includes(d.id) }));
  }
  let added = 0;
  if (pl.kind === "merit") {
    for (const sc of pl.scouts) { const r = { name: St.tidyName(sc.name) || sc.name, patrol: "", troop: sc.troop }; if (!findDup(ev.id, r)) { St.savePerson({ eventId: ev.id, ...r }); added++; } }
  } else {
    for (const pt of pl.patrols) {
      const key = St.teamKey(pt);
      const at = ev.schedule.findIndex((x) => St.teamKey(x) === key);
      const entry = { troop: pt.troop, patrol: pt.patrol, times: { ...(at >= 0 ? ev.schedule[at].times : {}), ...pt.times } };
      if (at >= 0) ev.schedule[at] = entry; else ev.schedule.push(entry);
      for (let i = 1; i <= (pt.count || 0); i++) {
        const r = { name: `Participant ${i}`, patrol: pt.patrol, troop: pt.troop };
        if (!findDup(ev.id, r)) { St.savePerson({ eventId: ev.id, ...r }); added++; }
      }
    }
  }
  St.saveEvent(ev);
  St.setSetting("activeEvent", ev.id);
  return { ev, added };
}

function viewShare(ev) {
  return `<div class="card"><h2>Bring other instructors in</h2>
    <p class="small muted">They scan this code or open the link, and the app opens on this event. Print it for the range table.</p>
    <div id="qrBox" style="display:flex;justify-content:center;padding:10px;background:#fff"></div>
    <p class="small" style="word-break:break-all;text-align:center"><span id="evLink">${esc(eventLink(ev))}</span></p>
    <div class="btns" style="justify-content:center"><button class="btn slim" data-act="copyLink">Copy link</button></div>
  </div>
  <div class="card ${ev.locked ? "soft" : ""}"><h2>${ev.locked ? "Scoring is locked" : "Final results"}</h2>
    <p class="small muted">${ev.locked ? "Scores for this event can't be added, changed or deleted on any phone. Unlock only if a score has to be fixed." : "When scoring is done, lock the event so nothing changes after results are printed. It locks on every phone after they sync."}</p>
    <button class="btn ${ev.locked ? "" : "dark"}" data-act="toggleLock">${ev.locked ? "Unlock scoring" : "Lock scoring"}</button>
  </div>`;
}

function viewRoster(ev) {
  const people = St.roster(ev.id);
  const groups = new Map();
  people.forEach((p) => { const k = St.team(p); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); });
  return `<div class="card"><h2>Participants at ${esc(ev.name)}</h2>
    <p class="small muted">First name and last initial only. For patrol-only scoring, leave the name blank and just fill in the patrol.</p>
    <div class="row"><label class="f"><span>Name</span><input type="text" id="pName" placeholder="Alex R." autocomplete="off"></label></div>
    <div class="row">
      <label class="f"><span>Patrol</span><input type="text" id="pPatrol" list="patrolList" placeholder="Eagle" autocomplete="off"></label>
      <label class="f"><span>Troop</span><input type="text" id="pTroop" list="troopList" placeholder="42" autocomplete="off"></label>
    </div>
    <datalist id="patrolList">${[...new Set(people.map((p) => p.patrol).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
    <datalist id="troopList">${[...new Set(people.map((p) => p.troop).filter(Boolean))].map((x) => `<option value="${esc(x)}">`).join("")}</datalist>
    <div class="btns"><button class="btn primary" data-act="addPerson">Add</button><button class="btn" data-act="togglePaste">${S.pasteOpen ? "Close list" : "Paste a list"}</button></div>
    ${S.pasteOpen ? `<div style="margin-top:12px"><label class="f"><span>One per line: name, patrol, troop</span><textarea id="pasteBox" placeholder="Alex Rivera, Eagle, 42\nMia Chen, Eagle, 42\nSam Ortiz, Fox, 7"></textarea></label>
      <button class="btn dark" data-act="importPaste">Add these</button> <span class="small muted">Full last names are cut to an initial.</span></div>` : ""}
    <p class="small muted" style="margin-top:12px">${people.length} on the list</p>
    ${[...groups.entries()].map(([k, ps]) => `<h3>${esc(k)}</h3><ul class="list">${ps.map((p) => `<li><div class="grow name">${esc(St.display(p))}</div><button class="x" title="Remove" data-act="delPerson" data-id="${p.id}">×</button></li>`).join("")}</ul>`).join("")}
  </div>`;
}

// ---------------- score

function viewScore() {
  const ev = activeEvent();
  if (!ev) return `<h1>Score</h1><div class="card soft"><p>Pick or make an event first.</p><button class="btn primary" data-tab="events">Go to Events</button></div>`;
  if (ev.locked) return `<h1>${esc(ev.name)}</h1><div class="card soft"><h2>Scoring is locked</h2><p>This event's results are final. Scores can't be added or changed.</p><div class="btns"><button class="btn primary" data-tab="results">See results</button><button class="btn" data-tab="events">Events</button></div></div>`;
  const d = currentDiscipline();
  if (!d) return `<h1>${esc(ev.name)}</h1><div class="card soft"><p>This event has nothing turned on to score.</p><button class="btn" data-act="editEvent" data-id="${ev.id}">Edit event</button></div>`;
  let h = `${!St.settings().instructor ? `<div class="card soft"><h2>Who's scoring?</h2><p class="small muted">Your name goes on the scores you enter, so questions come to the right person.</p>
      <div class="row"><input type="text" id="firstName" placeholder="First name and last initial" autocomplete="name"><button class="btn primary" data-act="saveName" style="flex:0 0 auto">Save</button></div></div>` : ""}
    <h1>${esc(ev.name)}</h1>
    <div class="chips">${disciplinesOn(ev).map((x) => `<button class="chip ${x.id === d.id ? "on" : ""}" data-act="pickDisc" data-id="${x.id}">${esc(x.name)}</button>`).join("")}</div>`;
  h += viewParticipantPick(ev);
  h += d.kind === "group" ? viewGroupScoring(ev, d) : viewPointsScoring(ev, d);
  h += viewRecent(ev, d);
  return h;
}

function viewParticipantPick(ev) {
  const people = St.roster(ev.id);
  const sel = person(S.personId);
  const q = S.search.trim().toLowerCase();
  const list = people.filter((p) => !q || (St.display(p) + " " + St.team(p)).toLowerCase().includes(q));
  const btn = (p, sub) => `<button data-act="pickPerson" data-id="${p.id}" class="${p.id === S.personId ? "on" : ""}"><b>${esc(St.display(p))}</b>${sub ? `<small>${esc(St.team(p))}</small>` : ""}</button>`;
  let body;
  const sch = ev.schedule || [];
  if (sch.length && ev.kind !== "merit") {
    // camporee: one block per patrol, in report-time order for this range
    const d = currentDiscipline();
    const timeOf = (p) => sch.find((x) => St.teamKey(x) === St.teamKey(p))?.times?.[d.id] || "";
    const teams = new Map();
    list.forEach((p) => { const k = St.teamKey(p); if (!teams.has(k)) teams.set(k, { label: St.team(p), time: timeOf(p), people: [] }); teams.get(k).people.push(p); });
    const order = [...teams.values()].sort((a, b) => (RF.minutes(a.time) ?? 9999) - (RF.minutes(b.time) ?? 9999) || a.label.localeCompare(b.label));
    body = order.map((t) => `<h3 style="display:flex;justify-content:space-between;gap:8px"><span>${esc(t.label)}</span>${t.time ? `<span style="color:var(--red)">${esc(d.name)} ${esc(RF.clock(t.time))}</span>` : ""}</h3>
      <div class="pick" style="max-height:none">${t.people.map((p) => btn(p, false)).join("")}</div>`).join("") || '<span class="muted small">No match.</span>';
    body = `<div style="max-height:420px;overflow:auto">${body}</div>`;
  } else {
    body = `<div class="pick">${list.map((p) => btn(p, true)).join("") || '<span class="muted small">No match.</span>'}</div>`;
  }
  return `<div class="card"><h2>Participant${sel ? `: <span style="color:var(--red)">${esc(St.label(sel))}</span>` : ""}</h2>
    ${people.length ? `<input type="search" id="search" value="${esc(S.search)}" placeholder="Find a name, patrol or troop" style="margin-bottom:8px">${body}`
    : `<p class="muted">No participants yet.</p><button class="btn" data-tab="events">Add participants</button>`}
  </div>`;
}

function viewPointsScoring(ev, d) {
  return `<div class="card"><h2>${esc(d.name)} score</h2>
    <label class="f"><span>Score${d.max ? ` (out of ${d.max})` : ""}</span><input type="number" id="pts" inputmode="numeric" min="0" ${d.max ? `max="${d.max}"` : ""} style="font-size:28px;min-height:60px"></label>
    <button class="btn primary big block" data-act="savePoints" ${S.personId ? "" : "disabled"}>${S.personId ? "Save score for " + esc(St.label(person(S.personId))) : "Pick a participant first"}</button>
  </div>`;
}

function viewGroupScoring(ev, d) {
  const cal = caliberOf(S.caliberId || d.caliberId);
  const sh = sheetChoice();
  let h = `<div class="card"><h2>Target</h2><div class="row">
    <label class="f"><span>Caliber</span><select id="calSel">${CALIBERS.map((c) => `<option value="${c.id}" ${c.id === cal.id ? "selected" : ""}>${c.label}</option>`).join("")}</select></label>
    <label class="f"><span>Target sheet size</span><select id="sheetSel">${SHEETS.map((s) => `<option value="${s.id}" ${s.id === sh.id ? "selected" : ""}>${s.label}</option>`).join("")}</select></label></div>
    ${sh.id === "custom" ? `<div class="row"><label class="f"><span>Width (in)</span><input type="number" step="0.01" id="shW" value="${sh.w || ""}"></label><label class="f"><span>Height (in)</span><input type="number" step="0.01" id="shH" value="${sh.h || ""}"></label></div>` : ""}
    <p class="small muted">The scale comes from the size of clean ${esc(cal.label)} holes. The sheet size is the backup when every hole is torn together, as in a tight dime group.</p>
  </div>`;
  const a = S.a;
  if (!a) {
    h += `<div class="card"><h2>Take the photo</h2>
      <ol class="steps small"><li>Take the target down and lay it on a <b>bright green or orange board</b>, with board showing on every side.</li>
      <li>Fit the whole sheet in the photo, all four corners. An angle is fine.</li>
      <li>Good light, no shadow from your phone across the holes.</li></ol>
      <label class="btn primary big block" style="margin-top:12px">Take photo<input type="file" accept="image/*" capture="environment" id="camIn" class="hide"></label>
      <label class="btn block" style="margin-top:8px">Choose a saved photo<input type="file" accept="image/*" id="fileIn" class="hide"></label>
    </div>`;
    return h;
  }
  if (a.busy) return h + `<div class="card"><div class="spinner"></div><p style="text-align:center">Measuring…</p></div>`;
  if (a.error) return h + `<div class="card"><div class="note warn">${esc(a.error)}</div><button class="btn" data-act="newPhoto">Try another photo</button></div>`;
  if (a.mode === "corners") return h + `<div class="card"><h2>Mark the corners</h2><p class="small muted">Drag the four red dots onto the corners of the target sheet.</p>
      <div class="canvasWrap editing"><canvas id="cornerCv"></canvas></div>
      <div class="tools"><button class="btn primary" data-act="applyCorners">Use these corners</button><button class="btn" data-act="cancelCorners">Cancel</button></div></div>`;
  const r = a.res;
  h += (r.warnings || []).map((w) => `<div class="note warn">${esc(w)}</div>`).join("");
  if (!r.ok) return h + `<div class="card"><p>Couldn't find the target sheet in this photo.</p><div class="btns"><button class="btn primary" data-act="cornerMode">Mark the corners by hand</button><button class="btn" data-act="newPhoto">New photo</button></div></div>`;

  if (!r.ppi || a.mode === "scale") {
    return h + `<div class="card"><h2>Set the scale by hand</h2>
      <p class="small muted">Tap two points a known distance apart, such as the two edges of a printed dot or two grid lines.</p>
      <div class="canvasWrap"><canvas id="overCv"></canvas></div>
      ${a.scalePts?.length === 2 ? `<div class="row" style="margin-top:10px"><label class="f"><span>Distance between them (inches)</span><input type="number" step="0.001" id="scaleIn" inputmode="decimal"></label></div><button class="btn primary" data-act="applyScale">Apply</button>` : `<p class="small">${a.scalePts?.length || 0} of 2 points</p>`}
      <div class="tools">${r.ppi ? '<button class="btn" data-act="cancelScale">Cancel</button>' : ""}<button class="btn" data-act="newPhoto">New photo</button></div></div>`;
  }

  const N = ev.shotsPerGroup || 5;
  const g = a.groups[a.sel];
  const m = g && g.shots.length ? measureGroup(g.shots, r.ppi, r.holeIn) : null;
  a.m = m;
  const is22 = a.calId === "22lr";
  const close = (x) => Math.abs(x) < 0.02;
  const marg = (x) => (x >= 0 ? `${fmt(x, 2)} in to spare` : `over by ${fmt(-x, 2)} in`);
  const srcText = r.scaleSource === "holes" ? `Scale from ${r.singles} clean ${esc(caliberOf(a.calId).label)} hole${r.singles === 1 ? "" : "s"}`
    : r.scaleSource === "sheet" ? "Scale from the sheet size (no clean single hole)" : "Scale set by hand";
  const L = (x) => LETTERS[a.groups.indexOf(x)] || String(a.groups.indexOf(x) + 1);
  const scored = a.groups.filter((x) => x.shots.length);
  const off = scored.filter((x) => x.shots.length !== N);
  const pid = S.personId, pName = pid ? St.label(person(pid)) : "";
  const savedHere = !!(g && pid && (g.savedIds || []).includes(pid));
  const unsaved = pid ? scored.filter((x) => !(x.savedIds || []).includes(pid)) : [];
  h += `<div class="card"><h2>Found on this sheet</h2>
    <p class="small muted">Each bullseye is its own group. Tap a group to check it.</p>
    <div class="groupTabs">${a.groups.map((x, i) => { const n = x.shots.length, bad = n && n !== N; return `<button class="chip ${i === a.sel ? "on" : ""} ${bad ? "warnchip" : ""}" data-act="pickGroup" data-i="${i}">Group ${L(x)} · ${n} of ${N}${x.savedFor ? " ✓" : ""}</button>`; }).join("")}
      <button class="chip" data-act="newGroup">+ Group</button></div>
    ${off.length ? `<div class="note warn" style="margin-top:10px"><b>${off.length === 1 ? "1 group doesn't" : off.length + " groups don't"} have ${N} shots.</b> ${off.map((x) => `Group ${L(x)} has ${x.shots.length}`).join(", ")}. A hole may be hidden in a torn group, or a mark was counted as a hole. Tap <b>Fix markers</b> to correct it.</div>`
      : scored.length ? `<div class="note info" style="margin-top:10px">Every group has ${N} shots.</div>` : ""}
  </div>
  <div class="card"><h2>Group ${g ? L(g) : ""}</h2>
    <div class="canvasWrap ${a.edit ? "editing" : ""}"><canvas id="groupCv"></canvas></div>
    <p class="small muted" style="margin:6px 0 0">${a.edit ? "<b>Fixing:</b> drag a marker to move it, tap an empty spot to add a shot, or tap a marker and press Remove." : "Yellow rings are the holes it found, at true size." + (is22 ? " The gray rings are a quarter and a dime." : "")}</p>
    <div class="tools">
      <button class="btn slim ${a.edit ? "dark" : ""}" data-act="toggleEdit">${a.edit ? "Done fixing" : "Fix markers"}</button>
      ${a.edit ? `<button class="btn slim" data-act="delShot" ${a.selShot == null ? "disabled" : ""}>Remove marker</button><button class="btn slim" data-act="undo" ${a.hist.length ? "" : "disabled"}>Undo</button>` : ""}
      <button class="btn slim" data-act="fitView">Re-center</button>
    </div>
    ${m ? `<div><span class="muted small">Group size, center to center</span><div><span class="big-number">${fmt(m.spreadIn)}</span> <span class="unit">in</span></div>
      <div class="small muted">Outside edges ${fmt(m.outsideIn)} in · <b style="color:${m.n === N ? "inherit" : "var(--warn)"}">${m.n} of ${N} shots</b></div></div>
      ${is22 ? `<div class="verdicts">
        <div class="verdict ${m.dime.pass ? "pass" : "fail"} ${close(m.dime.marginIn) ? "close" : ""}"><span class="small">Dime club</span><b>${m.dime.pass ? "Covered" : "Not covered"}</b><span class="small">${marg(m.dime.marginIn)}</span></div>
        <div class="verdict ${m.quarter.pass ? "pass" : "fail"} ${close(m.quarter.marginIn) ? "close" : ""}"><span class="small">Merit badge quarter</span><b>${m.quarter.pass ? "Touches all" : "Misses a hole"}</b><span class="small">${marg(m.quarter.marginIn)}</span></div>
      </div>
      ${close(m.dime.marginIn) || close(m.quarter.marginIn) ? '<div class="note warn" style="margin-top:10px">Too close to call from a photo. Check it with a real coin.</div>' : ""}` : ""}` : '<p class="muted">No shots in this group yet. Tap <b>Fix markers</b>, then tap the holes to add them.</p>'}
    <p class="small muted" style="margin-top:10px">${srcText} · ${fmt(r.ppi, 0)} px per inch</p>
    <div style="display:grid;gap:8px">
      <button class="btn primary big block" data-act="saveGroup" ${pid && m && !savedHere ? "" : "disabled"}>${!pid ? "Pick a participant to save" : savedHere ? "Saved for " + esc(pName) + " ✓" : `Save group ${L(g)} for ` + esc(pName)}</button>
      ${pid && scored.length > 1 && unsaved.length > 1 ? `<button class="btn dark block" data-act="saveAll">Save all ${unsaved.length} groups for ${esc(pName)}</button>` : ""}
    </div>
  </div>
  <div class="card"><h2>Whole sheet</h2><p class="small muted">Tap a group to work on it.</p><div class="canvasWrap"><canvas id="overCv"></canvas></div>
    <div class="tools"><button class="btn slim" data-act="cornerMode">Fix corners</button><button class="btn slim" data-act="scaleMode">Set scale by hand</button><button class="btn slim" data-act="rerun">Measure again</button><button class="btn slim dark" data-act="newPhoto">New photo</button></div></div>`;
  return h;
}

function viewRecent(ev, d) {
  const list = St.scoresFor(ev.id).filter((s) => s.disciplineId === d.id).slice(0, 25);
  if (!list.length) return "";
  return `<div class="card"><h2>Recent ${esc(d.name)} scores</h2><ul class="list">${list.map((s) => {
    const p = person(s.personId);
    const val = d.kind === "group" ? `${fmt(s.value)} in${s.dime ? " · dime" : ""}${s.quarter ? " · quarter" : ""}` : `${s.value}${d.max ? " / " + d.max : ""}`;
    return `<li><div class="grow"><div class="name">${esc(p ? St.label(p) : "?")}</div><div class="small muted">${esc(val)} · ${new Date(s.at).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}${s.instructor ? " · " + esc(s.instructor) : ""}</div></div><button class="x" data-act="delScore" data-id="${s.id}">×</button></li>`;
  }).join("")}</ul></div>`;
}

// ---------------- results

function viewResults() {
  const ev = activeEvent();
  if (!ev) return `<h1>Results</h1><div class="card soft"><p>Pick an event first.</p><button class="btn primary" data-tab="events">Go to Events</button></div>`;
  const st = St.standings(ev.id);
  const ds = st.disciplines.map((x) => x.discipline);
  let h = `<h1>${esc(ev.name)} results${ev.locked ? ' <span class="chip on" style="vertical-align:middle;font-size:13px">Final</span>' : ""}</h1>
    ${st.unassigned.length && ev.kind !== "merit" ? `<div class="note warn">${st.unassigned.length === 1 ? "1 participant has" : st.unassigned.length + " participants have"} no patrol or troop, so ${st.unassigned.length === 1 ? "isn't" : "aren't"} in the patrol rankings: ${st.unassigned.map((p) => esc(St.display(p))).join(", ").replace(/\.$/, "")}. Fix it on the Events tab.</div>` : ""}
    ${cfg.preview ? '<div class="note info">This is the preview copy. The Excel and PDF buttons and shared scores work once the app is on its own web address.</div>' : ""}
    <div class="btns" style="margin-bottom:14px"><button class="btn primary" data-act="xlsx">Excel file</button><button class="btn primary" data-act="pdf">PDF to print</button><button class="btn" data-act="syncNow">Sync now</button></div>
    ${ev.kind === "merit" ? "" : `<div class="card"><h2>Patrols</h2><p class="small muted">Each event is out of 100: the best patrol gets 100, others get their share. Patrol score is the average of its participants.</p>
    <div class="tableWrap"><table><thead><tr><th>#</th><th>Patrol</th>${ds.map((d) => `<th class="num">${esc(d.name)}</th>`).join("")}<th class="num">Total</th></tr></thead><tbody>
    ${st.patrols.map((p) => `<tr><td class="rank">${p.rank}</td><td>${esc(p.label)}<div class="small muted">${p.members} on list</div></td>${ds.map((d) => `<td class="num">${p.by[d.id] ? fmt(p.by[d.id].points, 1) : "–"}</td>`).join("")}<td class="num"><b>${fmt(p.total, 1)}</b></td></tr>`).join("") || `<tr><td colspan="${ds.length + 3}" class="muted">No participants yet.</td></tr>`}
    </tbody></table></div></div>`}`;
  for (const x of st.disciplines) {
    const d = x.discipline;
    h += `<div class="card"><h2>${esc(d.name)}</h2><div class="tableWrap"><table><thead><tr><th>#</th><th>Participant</th><th class="num">${d.kind === "group" ? "Group (in)" : "Score"}</th>${d.kind === "group" && x.hasCoins ? '<th class="num">Quarter</th><th class="num">Dime</th>' : ""}</tr></thead><tbody>
      ${x.individuals.map((r) => `<tr><td class="rank">${r.rank}</td><td>${esc(St.display(r.person))}<div class="small muted">${esc(St.team(r.person))}</div></td><td class="num">${d.kind === "group" ? fmt(r.value) : fmt(r.value, Number.isInteger(r.value) ? 0 : 1)}${r.entries > 1 ? `<div class="small muted">${r.entries} groups</div>` : ""}</td>${d.kind === "group" && x.hasCoins ? `<td class="num">${r.coins ? `${r.coins.quarter} of ${r.coins.groups}` : "–"}</td><td class="num">${r.coins ? `${r.coins.dime} of ${r.coins.groups}` : "–"}</td>` : ""}</tr>`).join("") || '<tr><td colspan="5" class="muted">No scores yet.</td></tr>'}
      </tbody></table></div></div>`;
  }
  return h;
}

// ---------------- settings

function viewSettings() {
  const s = St.settings();
  return `<h1>Settings</h1>
  <div class="card"><label class="f"><span>Your name (shown on scores you enter)</span><input type="text" id="setInstr" value="${esc(s.instructor)}" placeholder="e.g. Randall B."></label></div>
  <div class="card"><h2>Shared scores</h2>
    <p class="small muted">Scores save on this phone first and send to the club Google Sheet when there's signal, so several instructors can score one event.</p>
    <label class="f"><span>Sheet web address</span><input type="url" id="setUrl" value="${esc(s.syncUrl)}" placeholder="https://script.google.com/macros/s/…/exec"></label>
    <div class="btns"><button class="btn" data-act="syncNow">Sync now</button></div>
    <p class="small muted">${s.syncUrl ? (St.data().lastSync ? "Last synced " + new Date(St.data().lastSync).toLocaleString() : "Not synced yet") : "Not set up. Scores stay on this phone."}</p>
  </div>
  <div class="card"><h2>Hole size correction</h2>
    <p class="small muted">Paper often closes up a little around a bullet, so the hole measures smaller than the caliber. These values are set on the site so every phone measures the same way. 1.00 means the hole is the bullet's size.</p>
    <ul class="list">${CALIBERS.slice(0, 3).map((c) => `<li><div class="grow">${c.label}</div><b>${holeFactor(c.id).toFixed(2)}</b></li>`).join("")}</ul>
  </div>
  <div class="card"><h2>About</h2><p class="small">Georgia-Carolina Council RATA scoring. Group size is measured center to center. Dime club: a dime (0.705 in) must cover all ${"five"} holes completely. Merit badge: a quarter (0.955 in) must touch all five holes.</p>
    <button class="btn" data-act="wipe">Clear everything on this phone</button></div>`;
}

// ------------------------------------------------------------------ after render: inputs and canvases

function afterRender() {
  const on = (id, ev, fn) => { const el = document.getElementById(id); if (el) el.addEventListener(ev, fn); };
  on("search", "input", (e) => { S.search = e.target.value; const pos = e.target.selectionStart; render(); const s = $("#search"); if (s) { s.focus(); s.setSelectionRange(pos, pos); } });
  on("camIn", "change", (e) => e.target.files[0] && startPhoto(e.target.files[0]));
  on("qrIn", "change", (e) => e.target.files[0] && importQr(e.target.files[0]));
  on("xlsIn", "change", (e) => e.target.files[0] && importXlsx(e.target.files[0]));
  on("fileIn", "change", (e) => e.target.files[0] && startPhoto(e.target.files[0]));
  on("calSel", "change", (e) => { S.caliberId = e.target.value; if (S.a?.photo) rerun(); else render(); });
  on("sheetSel", "change", (e) => { const cur = St.settings().sheet || {}; St.setSetting("sheet", { ...cur, id: e.target.value }); if (S.a?.photo && e.target.value !== "custom") rerun(); else render(); });
  const custom = () => { const w = Number($("#shW")?.value), h = Number($("#shH")?.value); St.setSetting("sheet", { id: "custom", w, h }); if (S.a?.photo && w > 0 && h > 0) rerun(); };
  on("shW", "change", custom); on("shH", "change", custom);
  on("setInstr", "change", (e) => St.setSetting("instructor", e.target.value.trim()));
  on("setUrl", "change", (e) => { St.setSetting("syncUrl", e.target.value.trim()); renderSync(); doSync(); });
  $$("[data-hf]").forEach((el) => el.addEventListener("change", () => { const hf = { ...(St.settings().holeFactor || {}) }; hf[el.dataset.hf] = Number(el.value) || 1; St.setSetting("holeFactor", hf); }));
  if (S.tab === "events" && S.editEvent) $$("[data-d]").forEach((el) => el.addEventListener("change", () => {
    const d = S.editEvent.disciplines[+el.dataset.d];
    const k = el.dataset.k;
    d[k] = el.type === "checkbox" ? el.checked : k === "max" ? Number(el.value) || 0 : el.value;
  }));
  if (S.a && !S.a.busy) drawCanvases();
  const qb = $("#qrBox");
  if (qb) drawQr(qb, $("#evLink").textContent);
}

async function drawQr(box, text) {
  try {
    if (!window.QRCode) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js");
    box.innerHTML = "";
    new window.QRCode(box, { text, width: 200, height: 200, correctLevel: window.QRCode.CorrectLevel.M });
  } catch { box.innerHTML = '<span class="small muted">The QR code needs signal the first time. The link below works either way.</span>'; }
}

// ------------------------------------------------------------------ photo and measuring

async function loadPhoto(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const k = Math.min(1, 3200 / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.round(img.naturalWidth * k), h = Math.round(img.naturalHeight * k);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const ctx = c.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, w, h);
    const id = ctx.getImageData(0, 0, w, h);
    return { width: w, height: h, data: id.data, canvas: c };
  } finally { URL.revokeObjectURL(url); }
}

let worker;
function runEngine(photo, opts) {
  return new Promise((resolve, reject) => {
    const here = () => setTimeout(() => { try { resolve(analyzeHere(photo, opts)); } catch (e) { reject(e); } }, 30);
    if (worker === undefined) { try { worker = new Worker("worker.js", { type: "module" }); } catch { worker = null; } }
    if (!worker) return here();
    worker.onmessage = (e) => (e.data.ok ? resolve(e.data.result) : reject(new Error(e.data.error)));
    worker.onerror = () => { worker = null; here(); };
    worker.postMessage({ img: { width: photo.width, height: photo.height, data: photo.data }, opts });
  });
}

async function startPhoto(file) {
  S.a = { busy: true, hist: [] };
  render();
  try {
    S.a.photo = await loadPhoto(file);
  } catch {
    S.a = { error: "Couldn't open that photo. Try taking it again.", hist: [] };
    return render();
  }
  rerun();
}

async function rerun(extra = {}) {
  const a = S.a;
  if (!a?.photo) return;
  const ev = activeEvent(), d = currentDiscipline();
  const cal = caliberOf(S.caliberId || d.caliberId);
  const sh = sheetChoice();
  const opts = {
    caliberIn: cal.diaIn,
    holeFactor: holeFactor(cal.id),
    shotsPerGroup: ev.shotsPerGroup || 5,
    sheet: sh.w > 0 && sh.h > 0 ? { w: sh.w, h: sh.h } : null,
    ...extra,
  };
  if (a.corners) opts.corners = a.corners;
  a.busy = true; a.mode = null; a.error = null; a.calId = cal.id;
  render();
  try {
    const res = await runEngine(a.photo, opts);
    a.res = res;
    a.opts = opts;
    a.groups = (res.groups || []).map((g) => ({ shots: g.shots.map((s) => ({ x: s.x, y: s.y })), note: g.note }));
    a.sel = 0; a.selShot = null; a.hist = []; a.crop = null;
    if (res.corners) a.corners = res.corners;
    if (res.rect) {
      const c = document.createElement("canvas");
      c.width = res.rect.width; c.height = res.rect.height;
      c.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(res.rect.data), res.rect.width, res.rect.height), 0, 0);
      a.rectCanvas = c;
    }
    if (res.ok && !res.ppi) { a.mode = "scale"; a.scalePts = []; }
  } catch (e) {
    a.error = "Something went wrong measuring this photo. Try another photo.";
    console.error(e);
  }
  a.busy = false;
  render();
}

// ---------------- drawing

function sizeCanvas(cv, aspect) {
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const w = cv.parentElement.clientWidth;
  cv.width = Math.round(w * dpr);
  cv.height = Math.round(w * aspect * dpr);
  return dpr;
}

function cropFor(g, r) {
  if (!g.shots.length) {
    const c = S.a.crop;
    return c || { x: r.rect.width / 2 - r.ppi, y: r.rect.height / 2 - r.ppi, s: r.ppi * 2 };
  }
  const m = measureGroup(g.shots, r.ppi, r.holeIn);
  const cx = m.circle.x * r.ppi, cy = m.circle.y * r.ppi;
  const half = Math.max(0.75, m.circle.r + r.holeIn / 2 + 0.35) * r.ppi;
  return { x: cx - half, y: cy - half, s: half * 2 };
}

function drawCanvases() {
  const a = S.a, r = a.res;
  const cc = $("#cornerCv");
  if (cc) drawCorners(cc);
  const over = $("#overCv");
  if (over && a.rectCanvas) drawOverview(over);
  const gc = $("#groupCv");
  if (gc && r?.ppi) drawGroup(gc);
}

function drawOverview(cv) {
  const a = S.a, r = a.res, rc = a.rectCanvas;
  const dpr = sizeCanvas(cv, rc.height / rc.width);
  const k = cv.width / rc.width;
  const ctx = cv.getContext("2d");
  ctx.drawImage(rc, 0, 0, cv.width, cv.height);
  if (a.mode === "scale" || !r.ppi) {
    (a.scalePts || []).forEach((p) => { ctx.fillStyle = "#b3131b"; ctx.beginPath(); ctx.arc(p.x * k, p.y * k, 6 * dpr, 0, 7); ctx.fill(); });
    if (a.scalePts?.length === 2) { ctx.strokeStyle = "#b3131b"; ctx.lineWidth = 2 * dpr; ctx.beginPath(); ctx.moveTo(a.scalePts[0].x * k, a.scalePts[0].y * k); ctx.lineTo(a.scalePts[1].x * k, a.scalePts[1].y * k); ctx.stroke(); }
  } else {
    a.groups.forEach((g, i) => {
      if (!g.shots.length) return;
      const xs = g.shots.map((s) => s.x), ys = g.shots.map((s) => s.y);
      const pad = 0.25 * r.ppi;
      const x0 = (Math.min(...xs) - pad) * k, y0 = (Math.min(...ys) - pad) * k;
      const x1 = (Math.max(...xs) + pad) * k, y1 = (Math.max(...ys) + pad) * k;
      ctx.lineWidth = (i === a.sel ? 3 : 2) * dpr;
      ctx.strokeStyle = i === a.sel ? "#b3131b" : "#ffd400";
      ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = ctx.strokeStyle;
      ctx.font = `bold ${14 * dpr}px Arial`;
      ctx.fillText(LETTERS[i] || String(i + 1), x0, Math.max(14 * dpr, y0 - 4 * dpr));
    });
  }
  cv.onpointerdown = (e) => {
    const b = cv.getBoundingClientRect();
    const x = ((e.clientX - b.left) / b.width) * rc.width, y = ((e.clientY - b.top) / b.height) * rc.height;
    if (a.mode === "scale" || !r.ppi) {
      a.scalePts = (a.scalePts?.length >= 2 ? [] : a.scalePts || []).concat([{ x, y }]);
      render();
      return;
    }
    let best = -1, bd = Infinity;
    a.groups.forEach((g, i) => g.shots.forEach((s) => { const d = Math.hypot(s.x - x, s.y - y); if (d < bd) { bd = d; best = i; } }));
    if (best >= 0 && bd < 0.8 * r.ppi) { a.sel = best; a.selShot = null; a.crop = null; render(); }
  };
}

function drawGroup(cv) {
  const a = S.a, r = a.res, rc = a.rectCanvas;
  const g = a.groups[a.sel];
  if (!g) return;
  if (!a.crop) a.crop = cropFor(g, r);
  const c = a.crop;
  const dpr = sizeCanvas(cv, 1);
  const k = cv.width / c.s;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#222"; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.drawImage(rc, c.x, c.y, c.s, c.s, 0, 0, cv.width, cv.height);
  const P = (x, y) => [(x - c.x) * k, (y - c.y) * k];
  const m = g.shots.length ? measureGroup(g.shots, r.ppi, r.holeIn) : null;
  // other groups' markers, faint
  a.groups.forEach((og, i) => { if (i === a.sel) return; og.shots.forEach((s) => { const [x, y] = P(s.x, s.y); ctx.strokeStyle = "rgba(255,255,255,.5)"; ctx.lineWidth = 1 * dpr; ctx.beginPath(); ctx.arc(x, y, r.rPx * k, 0, 7); ctx.stroke(); }); });
  if (m) {
    const [mx, my] = P(m.circle.x * r.ppi, m.circle.y * r.ppi);
    for (const [coin, color, dash] of [[COINS.quarter, "rgba(220,220,220,.95)", [8, 6]], [COINS.dime, "rgba(160,200,255,.95)", []]]) {
      ctx.setLineDash(dash.map((v) => v * dpr)); ctx.strokeStyle = color; ctx.lineWidth = 2 * dpr;
      ctx.beginPath(); ctx.arc(mx, my, (coin.diaIn / 2) * r.ppi * k, 0, 7); ctx.stroke();
    }
    ctx.setLineDash([]);
    if (m.pair) {
      const [p, q] = m.pair.map((i) => P(g.shots[i].x, g.shots[i].y));
      ctx.strokeStyle = "#ff4d55"; ctx.lineWidth = 2 * dpr; ctx.setLineDash([6 * dpr, 4 * dpr]);
      ctx.beginPath(); ctx.moveTo(...p); ctx.lineTo(...q); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  g.shots.forEach((s, i) => {
    const [x, y] = P(s.x, s.y);
    const sel = i === a.selShot;
    ctx.strokeStyle = sel ? "#ff2a33" : "#ffd400"; ctx.lineWidth = (sel ? 3 : 2) * dpr;
    ctx.beginPath(); ctx.arc(x, y, r.rPx * k, 0, 7); ctx.stroke();
    ctx.fillStyle = ctx.strokeStyle; ctx.beginPath(); ctx.arc(x, y, 2.5 * dpr, 0, 7); ctx.fill();
  });

  // touch: drag a marker, tap empty to add
  let drag = null;
  const toRect = (e) => { const b = cv.getBoundingClientRect(); return { x: c.x + ((e.clientX - b.left) / b.width) * c.s, y: c.y + ((e.clientY - b.top) / b.height) * c.s }; };
  if (!a.edit) { cv.onpointerdown = cv.onpointermove = cv.onpointerup = null; return; }
  cv.onpointerdown = (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = toRect(e);
    const grab = Math.max(r.rPx * 1.1, (22 / (cv.getBoundingClientRect().width / c.s)));
    let bi = -1, bd = Infinity;
    g.shots.forEach((s, i) => { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0 && bd <= grab) {
      a.hist.push(JSON.stringify(a.groups));
      drag = { i: bi, dx: g.shots[bi].x - p.x, dy: g.shots[bi].y - p.y, moved: false };
      a.selShot = bi;
      drawGroup(cv);
    } else drag = { add: p };
  };
  cv.onpointermove = (e) => {
    if (!drag || drag.add) return;
    const p = toRect(e);
    g.shots[drag.i].x = p.x + drag.dx; g.shots[drag.i].y = p.y + drag.dy; drag.moved = true;
    drawGroup(cv);
  };
  cv.onpointerup = () => {
    if (!drag) return;
    if (drag.add) {
      a.hist.push(JSON.stringify(a.groups));
      g.shots.push({ x: drag.add.x, y: drag.add.y });
      a.selShot = g.shots.length - 1;
    } else if (drag.moved) a.hist.length && a.hist[a.hist.length - 1] === JSON.stringify(a.groups) && a.hist.pop();
    else a.hist.pop(); // a tap on a marker only selects it
    drag = null;
    render();
  };
}

function drawCorners(cv) {
  const a = S.a, pc = a.photo.canvas;
  if (!a.dragCorners) {
    const w = pc.width, h = pc.height;
    a.dragCorners = (a.corners || [[w * 0.15, h * 0.15], [w * 0.85, h * 0.15], [w * 0.85, h * 0.85], [w * 0.15, h * 0.85]]).map((p) => p.slice());
  }
  const dpr = sizeCanvas(cv, pc.height / pc.width);
  const k = cv.width / pc.width;
  const ctx = cv.getContext("2d");
  ctx.drawImage(pc, 0, 0, cv.width, cv.height);
  const q = a.dragCorners;
  ctx.strokeStyle = "#ff2a33"; ctx.lineWidth = 2 * dpr; ctx.beginPath();
  q.forEach((p, i) => (i ? ctx.lineTo(p[0] * k, p[1] * k) : ctx.moveTo(p[0] * k, p[1] * k))); ctx.closePath(); ctx.stroke();
  q.forEach((p) => { ctx.fillStyle = "rgba(255,42,51,.85)"; ctx.beginPath(); ctx.arc(p[0] * k, p[1] * k, 12 * dpr, 0, 7); ctx.fill(); });
  let drag = -1;
  const toPhoto = (e) => { const b = cv.getBoundingClientRect(); return [((e.clientX - b.left) / b.width) * pc.width, ((e.clientY - b.top) / b.height) * pc.height]; };
  cv.onpointerdown = (e) => {
    cv.setPointerCapture(e.pointerId);
    const p = toPhoto(e);
    let bd = Infinity;
    q.forEach((c, i) => { const d = Math.hypot(c[0] - p[0], c[1] - p[1]); if (d < bd) { bd = d; drag = i; } });
  };
  cv.onpointermove = (e) => { if (drag < 0) return; q[drag] = toPhoto(e); drawCorners(cv); };
  cv.onpointerup = () => { drag = -1; };
}

function findDup(eventId, p) {
  const norm = (x) => String(x || "").trim().toLowerCase().replace(/^troop\s*/, "");
  return St.roster(eventId).find((q) => norm(q.name) === norm(p.name) && norm(q.patrol) === norm(p.patrol) && norm(q.troop) === norm(p.troop));
}

function storeGroup(g, pid) {
  const a = S.a, r = a.res, ev = activeEvent(), d = currentDiscipline();
  const m = measureGroup(g.shots, r.ppi, r.holeIn);
  const is22 = a.calId === "22lr";
  St.saveScore({
    eventId: ev.id, personId: pid, disciplineId: d.id, disciplineName: d.name, kind: "group",
    value: Math.round(m.spreadIn * 1000) / 1000, spreadIn: m.spreadIn, outsideIn: m.outsideIn, shots: m.n,
    dime: is22 ? m.dime.pass : null, quarter: is22 ? m.quarter.pass : null,
    dimeMarginIn: is22 ? m.dime.marginIn : null, quarterMarginIn: is22 ? m.quarter.marginIn : null,
    caliber: caliberOf(a.calId).label, scaleSource: r.scaleSource, ppi: r.ppi,
  });
  g.savedIds = (g.savedIds || []).concat(pid);
  g.savedFor = St.label(person(pid));
  return m;
}

// ------------------------------------------------------------------ actions

const actions = {
  useEvent: (el) => { St.setSetting("activeEvent", el.dataset.id); S.personId = null; S.a = null; render(); },
  newEvent: () => { S.editEvent = { name: "", date: new Date().toISOString().slice(0, 10), location: "", shotsPerGroup: 5, disciplines: St.DEFAULT_DISCIPLINES.map((d) => ({ ...d })) }; render(); },
  editEvent: (el) => { S.tab = "events"; S.editEvent = JSON.parse(JSON.stringify(St.data().events[el.dataset.id])); render(); },
  cancelEvent: () => { S.editEvent = null; render(); },
  saveEvent: () => {
    const e = S.editEvent;
    e.name = $("#evName").value.trim();
    e.date = $("#evDate").value;
    e.location = $("#evLoc").value.trim();
    e.shotsPerGroup = Math.max(1, Math.min(20, Number($("#evShots").value) || 5));
    e.kind = $("#evKind").value;
    if (!e.name) return toast("Give the event a name.");
    const saved = St.saveEvent(e);
    St.setSetting("activeEvent", saved.id);
    S.editEvent = null;
    toast("Event saved");
    render(); doSyncSoon();
  },
  addPerson: () => {
    const ev = activeEvent();
    const name = St.tidyName($("#pName").value), patrol = $("#pPatrol").value.trim(), troop = $("#pTroop").value.trim();
    if (!name && !patrol) return toast("Enter a name or a patrol.");
    const dup = findDup(ev.id, { name, patrol, troop });
    if (dup) return toast(`${St.display(dup)} (${St.team(dup)}) is already on the list.`);
    St.savePerson({ eventId: ev.id, name, patrol, troop });
    render();
    $("#pPatrol").value = patrol; $("#pTroop").value = troop; $("#pName").focus();
    doSyncSoon();
  },
  togglePaste: () => { S.pasteOpen = !S.pasteOpen; render(); },
  importPaste: () => {
    const ev = activeEvent();
    const rows = St.parseRoster($("#pasteBox").value);
    let added = 0, skipped = 0;
    rows.forEach((r) => { if (findDup(ev.id, r)) skipped++; else { St.savePerson({ eventId: ev.id, ...r }); added++; } });
    S.pasteOpen = false;
    toast(`Added ${added}${skipped ? `, skipped ${skipped} already on the list` : ""}`);
    render(); doSyncSoon();
  },
  delPerson: (el) => { if (!confirmTap(el, "Remove?")) return; St.deletePerson(el.dataset.id); render(); doSyncSoon(); },
  pickDisc: (el) => { S.disciplineId = el.dataset.id; S.caliberId = null; S.a = null; render(); },
  pickPerson: (el) => { S.personId = el.dataset.id; render(); },
  savePoints: () => {
    if (activeEvent()?.locked) return toast("Scoring is locked for this event.");
    const d = currentDiscipline(), ev = activeEvent();
    const v = Number($("#pts").value);
    if ($("#pts").value === "" || !isFinite(v) || v < 0) return toast("Enter the score.");
    if (d.max && v > d.max) return toast(`Top score is ${d.max}.`);
    St.saveScore({ eventId: ev.id, personId: S.personId, disciplineId: d.id, disciplineName: d.name, kind: "points", value: v });
    toast(`Saved ${v} for ${St.label(person(S.personId))}`);
    S.personId = null; S.search = "";
    render(); doSyncSoon();
  },
  pickGroup: (el) => { S.a.sel = +el.dataset.i; S.a.selShot = null; S.a.crop = null; render(); },
  newGroup: () => { const a = S.a; a.hist.push(JSON.stringify(a.groups)); a.groups.push({ shots: [] }); a.sel = a.groups.length - 1; a.selShot = null; a.crop = null; a.edit = true; render(); },
  delShot: () => { const a = S.a, g = a.groups[a.sel]; if (a.selShot == null) return; a.hist.push(JSON.stringify(a.groups)); g.shots.splice(a.selShot, 1); a.selShot = null; render(); },
  undo: () => { const a = S.a; if (!a.hist.length) return; a.groups = JSON.parse(a.hist.pop()); a.selShot = null; render(); },
  fitView: () => { S.a.crop = null; render(); },
  cancelImport: () => { S.imp = null; render(); },
  applyImport: (el) => {
    const r = applyImport(S.imp.payload, el.dataset.into);
    S.imp = null;
    toast(`Loaded into ${r.ev.name}: ${r.added} participant${r.added === 1 ? "" : "s"} added`);
    render(); doSyncSoon();
  },
  copyOrg: async () => {
    try { await navigator.clipboard.writeText(ORGANIZER_URL()); toast("Link copied"); }
    catch { const r = document.createRange(); r.selectNodeContents($("#orgLink")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Link selected. Copy it from the menu."); }
  },
  copyLink: async () => {
    const t = $("#evLink").textContent;
    try { await navigator.clipboard.writeText(t); toast("Link copied"); }
    catch { const r = document.createRange(); r.selectNodeContents($("#evLink")); const sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); toast("Link selected. Copy it from the menu."); }
  },
  toggleLock: (el) => {
    const ev = activeEvent();
    if (!ev.locked && !confirmTap(el, "Tap again to lock")) return;
    St.saveEvent({ ...ev, locked: !ev.locked });
    toast(ev.locked ? "Scoring unlocked" : "Scoring locked");
    render(); doSyncSoon();
  },
  saveName: () => { const v = St.tidyName($("#firstName").value) || $("#firstName").value.trim(); if (!v) return toast("Enter your name."); St.setSetting("instructor", v); toast(`Thanks, ${v}`); render(); },
  toggleEdit: () => { S.a.edit = !S.a.edit; S.a.selShot = null; render(); },
  saveAll: (el) => {
    if (activeEvent()?.locked) return toast("Scoring is locked for this event.");
    const a = S.a, N = activeEvent().shotsPerGroup || 5, pid = S.personId;
    const todo = a.groups.filter((x) => x.shots.length && !(x.savedIds || []).includes(pid));
    const off = todo.filter((x) => x.shots.length !== N).length;
    if (off && !confirmTap(el, `${off === 1 ? "1 group doesn't" : off + " groups don't"} have ${N} shots. Tap again to save all`)) return;
    const name = St.label(person(pid));
    todo.forEach((g) => storeGroup(g, pid));
    toast(`Saved ${todo.length} groups for ${name}`);
    S.personId = null; S.search = "";
    render(); doSyncSoon();
  },
  saveGroup: (el) => {
    if (activeEvent()?.locked) return toast("Scoring is locked for this event.");
    const a = S.a, N = activeEvent().shotsPerGroup || 5, g = a.groups[a.sel], pid = S.personId;
    if ((g.savedIds || []).includes(pid)) return toast("This group is already saved for this participant.");
    if (g.shots.length !== N && !confirmTap(el, `Only ${g.shots.length} of ${N} shots. Tap again to save`)) return;
    const m = storeGroup(g, pid);
    toast(`Saved ${fmt(m.spreadIn)} in for ${St.label(person(pid))}`);
    S.personId = null; S.search = "";
    render(); doSyncSoon();
  },
  newPhoto: () => { S.a = null; render(); },
  rerun: () => rerun(),
  cornerMode: () => { S.a.mode = "corners"; S.a.dragCorners = null; render(); },
  cancelCorners: () => { S.a.mode = null; render(); },
  applyCorners: () => { S.a.corners = S.a.dragCorners; rerun(); },
  scaleMode: () => { S.a.mode = "scale"; S.a.scalePts = []; render(); },
  cancelScale: () => { S.a.mode = null; render(); },
  applyScale: () => {
    const a = S.a, dIn = Number($("#scaleIn").value);
    if (!(dIn > 0)) return toast("Enter the distance in inches.");
    const [p, q] = a.scalePts;
    rerun({ forcePpi: Math.hypot(p.x - q.x, p.y - q.y) / dIn });
  },
  delScore: (el) => {
    if (activeEvent()?.locked) return toast("Scoring is locked for this event."); if (!confirmTap(el, "Delete?")) return; St.deleteScore(el.dataset.id); render(); doSyncSoon(); },
  syncNow: () => doSync(true),
  xlsx: () => exportXlsx(),
  pdf: () => exportPdf(),
  wipe: (el) => { if (!confirmTap(el, "Tap again to clear this phone")) return; try { localStorage.clear(); } catch {} location.reload(); },
};

document.addEventListener("click", (e) => {
  const t = e.target.closest("[data-tab]");
  if (t) { S.tab = t.dataset.tab; S.editEvent = null; render(); window.scrollTo(0, 0); return; }
  const b = e.target.closest("[data-act]");
  if (b && actions[b.dataset.act] && !b.disabled) actions[b.dataset.act](b);
});
$("#syncBtn").addEventListener("click", () => doSync(true));

// ------------------------------------------------------------------ sync

let syncTimer;
function doSyncSoon() { renderSync(); clearTimeout(syncTimer); syncTimer = setTimeout(() => doSync(), 1500); }
async function doSync(loud) {
  if (!St.settings().syncUrl) { if (loud) toast("Add the sheet web address in Settings to share scores."); return; }
  if (S.syncState === "busy") return;
  S.syncState = "busy"; renderSync();
  const r = await St.sync();
  S.syncState = r.ok ? "ok" : r.reason === "offline" ? "offline" : "error";
  renderSync();
  if (loud) toast(r.ok ? `Synced · sent ${r.sent}, got ${r.received}` : r.reason === "offline" ? "No signal. Scores are safe on this phone and will send later." : "The sheet didn't answer: " + r.reason);
  if (r.ok && r.received && !(S.tab === "score" && S.a)) { if (S.tab === "events" && !activeEvent() && St.listEvents().length) S.tab = "score"; render(); }
}
window.addEventListener("online", () => doSync());
setInterval(() => { if (St.pendingCount() || S.tab === "results") doSync(); }, 60000);

// ------------------------------------------------------------------ export

function loadScript(src) {
  return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
}
function resultRows() {
  const ev = activeEvent();
  const st = St.standings(ev.id);
  const ds = st.disciplines.map((x) => x.discipline);
  const patrols = [["Rank", "Troop", "Patrol", ...ds.map((d) => d.name + " (of 100)"), "Total"]]
    .concat(st.patrols.map((p) => [p.rank, p.troop, p.patrol, ...ds.map((d) => (p.by[d.id] ? Math.round(p.by[d.id].points * 10) / 10 : "")), Math.round(p.total * 10) / 10]));
  const per = st.disciplines.map((x) => ({
    name: x.discipline.name,
    rows: [["Rank", "Participant", "Troop", "Patrol", x.discipline.kind === "group" ? "Group (in)" : "Score", "Entries", ...(x.hasCoins ? ["Quarter passes", "Dime passes"] : [])]]
      .concat(x.individuals.map((r) => [r.rank, St.display(r.person), r.person.troop, r.person.patrol, x.discipline.kind === "group" ? Math.round(r.value * 1000) / 1000 : r.value, r.entries,
        ...(x.hasCoins ? [r.coins ? `${r.coins.quarter} of ${r.coins.groups}` : "", r.coins ? `${r.coins.dime} of ${r.coins.groups}` : ""] : [])])),
  }));
  const all = [["When", "Participant", "Troop", "Patrol", "Event", "Value", "Shots", "Dime", "Quarter", "Caliber", "Scale from", "Instructor"]]
    .concat(St.scoresFor(ev.id).map((s) => { const p = person(s.personId) || {}; return [new Date(s.at).toLocaleString(), St.display(p), p.troop, p.patrol, s.disciplineName, s.value, s.shots ?? "", s.kind === "group" ? (s.dime ? "yes" : "no") : "", s.kind === "group" ? (s.quarter ? "yes" : "no") : "", s.caliber || "", s.scaleSource || "", s.instructor || ""]; }));
  return { ev, patrols, per, all };
}
const fileBase = (ev) => (ev.name || "results").replace(/[^a-z0-9]+/gi, "_").replace(/^_|_$/g, "") + "_results";

async function exportXlsx() {
  try { if (!window.XLSX) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"); }
  catch { return toast("Couldn't load the Excel tool. It needs signal the first time."); }
  const { ev, patrols, per, all } = resultRows();
  const wb = XLSX.utils.book_new();
  const add = (name, aoa) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = aoa[0].map((_, i) => ({ wch: Math.min(40, Math.max(8, ...aoa.map((r) => String(r[i] ?? "").length + 2))) })); XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31)); };
  if (ev.kind !== "merit") add("Patrols", [[ev.name], [ev.date + (ev.location ? " · " + ev.location : "")], [], ...patrols]);
  per.forEach((p) => add(p.name, p.rows));
  add("All scores", all);
  XLSX.writeFile(wb, fileBase(ev) + ".xlsx");
}

async function exportPdf() {
  try {
    if (!window.jspdf) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js");
    if (!window.jspdf.jsPDF.API.autoTable) await loadScript("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js");
  } catch { return toast("Couldn't load the PDF tool. It needs signal the first time."); }
  const { ev, patrols, per } = resultRows();
  const doc = new window.jspdf.jsPDF({ unit: "pt", format: "letter" });
  const red = [179, 19, 27];
  doc.setFillColor(20, 20, 20); doc.rect(0, 0, 612, 58, "F");
  doc.setFillColor(...red); doc.rect(0, 58, 612, 4, "F");
  doc.setTextColor(255, 107, 112); doc.setFontSize(9); doc.text("GEORGIA-CAROLINA COUNCIL RATA", 40, 24);
  doc.setTextColor(255, 255, 255); doc.setFontSize(18); doc.text(`${ev.name} — Results`, 40, 45);
  doc.setTextColor(20, 20, 20); doc.setFontSize(10);
  doc.text(`${ev.date || ""}${ev.location ? "  ·  " + ev.location : ""}  ·  Printed ${new Date().toLocaleDateString()}`, 40, 82);
  doc.setFontSize(9); doc.setTextColor(90, 90, 87);
  doc.text("Each event is scored out of 100: the best patrol gets 100 and the rest get their share. Group size is center to center; smaller is better.", 40, 96, { maxWidth: 532 });
  const style = { headStyles: { fillColor: red }, styles: { fontSize: 9 }, margin: { left: 40, right: 40 } };
  if (ev.kind !== "merit") doc.autoTable({ ...style, startY: 112, head: [patrols[0]], body: patrols.slice(1) });
  else doc.lastAutoTable = { finalY: 90 };
  for (const p of per) {
    let y = doc.lastAutoTable.finalY + 26;
    if (y > 700) { doc.addPage(); y = 50; }
    doc.setFontSize(13); doc.setTextColor(20, 20, 20); doc.text(p.name, 40, y);
    doc.autoTable({ ...style, startY: y + 8, head: [p.rows[0]], body: p.rows.slice(1) });
  }
  doc.save(fileBase(ev) + ".pdf");
}

// ------------------------------------------------------------------ start

render();
doSync();
if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
window.addEventListener("resize", () => { if (S.a && !S.a.busy) drawCanvases(); });
