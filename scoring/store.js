// Local data, syncing with the club Google Sheet, and rankings.
// Everything is saved on the phone first, so scoring works with no signal.
// When there is a connection, changes go to the sheet and other
// instructors' scores come back.

const KEY = "rata-scoring-v1";

export const DEFAULT_DISCIPLINES = [
  { id: "rifle", name: "Rifle .22", kind: "group", caliberId: "22lr", rule: "best", on: true },
  { id: "pistol", name: "Pistol 9mm", kind: "group", caliberId: "9mm", rule: "best", on: false },
  { id: "shotgun", name: "Shotgun", kind: "points", max: 25, rule: "total", on: true },
  { id: "archery", name: "Archery", kind: "points", max: 50, rule: "total", on: true },
];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const now = () => new Date().toISOString();

function blank() {
  return { events: {}, people: {}, scores: {}, settings: { instructor: "", syncUrl: "", holeFactor: {}, activeEvent: null, sheets: [] }, lastSync: null };
}

let db = blank();
export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) db = Object.assign(blank(), JSON.parse(raw));
  } catch { db = blank(); }
  db.settings = Object.assign(blank().settings, db.settings);
  return db;
}
export function save() {
  try { localStorage.setItem(KEY, JSON.stringify(db)); return true; } catch { return false; }
}
export const data = () => db;
export const settings = () => db.settings;
export function setSetting(k, v) { db.settings[k] = v; save(); }

function put(table, rec) {
  rec.updated = now();
  rec.dirty = true;
  db[table][rec.id] = rec;
  save();
  return rec;
}

// ------------------------------------------------------------------ events and roster

export function saveEvent(ev) {
  if (!ev.id) ev.id = uid();
  ev.type = "event";
  return put("events", ev);
}
export function listEvents() {
  return Object.values(db.events).filter((e) => !e.deleted).sort((a, b) => (b.date || "").localeCompare(a.date || ""));
}
export function savePerson(p) {
  if (!p.id) p.id = uid();
  p.type = "person";
  p.name = (p.name || "").trim();
  p.patrol = (p.patrol || "").trim();
  p.troop = (p.troop || "").trim();
  return put("people", p);
}
export function deletePerson(id) { const p = db.people[id]; if (p) { p.deleted = true; put("people", p); } }
export function roster(eventId) {
  return Object.values(db.people)
    .filter((p) => p.eventId === eventId && !p.deleted)
    .sort((a, b) => team(a).localeCompare(team(b)) || display(a).localeCompare(display(b)));
}
export const display = (p) => p.name || p.patrol || p.troop || "(no name)";
export const team = (p) => [p.troop && `Troop ${p.troop.replace(/^troop\s*/i, "")}`, p.patrol].filter(Boolean).join(" · ") || "No patrol";
export const teamKey = (p) => `${(p.troop || "").toLowerCase().replace(/^troop\s*/, "")}|${(p.patrol || "").toLowerCase()}`;

// "First L." — first name and last initial only.
export function tidyName(s) {
  const parts = String(s || "").trim().split(/\s+/).filter(Boolean);
  if (parts.length < 2) return parts[0] || "";
  const first = parts[0];
  const last = parts[parts.length - 1].replace(/\./g, "");
  return `${first} ${last.charAt(0).toUpperCase()}.`;
}

// Paste lines like "Alex Rivera, Eagle, 42" (name, patrol, troop).
export function parseRoster(text) {
  return String(text || "")
    .split(/\r?\n/)
    .map((l) => l.split(/\t|,/).map((x) => x.trim()))
    .filter((c) => c.some(Boolean))
    .filter((c) => !/^name$/i.test(c[0] || ""))
    .map((c) => ({ name: tidyName(c[0]), patrol: c[1] || "", troop: c[2] || "" }));
}

// ------------------------------------------------------------------ scores

export function saveScore(s) {
  if (!s.id) s.id = uid();
  s.type = "score";
  s.at = s.at || now();
  s.instructor = s.instructor || db.settings.instructor || "";
  return put("scores", s);
}
export function deleteScore(id) { const s = db.scores[id]; if (s) { s.deleted = true; put("scores", s); } }
export function scoresFor(eventId) {
  return Object.values(db.scores).filter((s) => s.eventId === eventId && !s.deleted).sort((a, b) => b.at.localeCompare(a.at));
}

// ------------------------------------------------------------------ rankings

function combine(values, rule, kind) {
  if (!values.length) return null;
  if (rule === "average") return values.reduce((a, b) => a + b, 0) / values.length;
  if (rule === "total" && kind === "points") return values.reduce((a, b) => a + b, 0);
  return kind === "group" ? Math.min(...values) : Math.max(...values);
}

// Individual and patrol standings. Each discipline is put on a 100 scale:
// the best patrol gets 100 and the rest get their share of it. For groups
// smaller is better, so a patrol averaging twice the best group size gets 50.
export function standings(eventId) {
  const ev = db.events[eventId];
  if (!ev) return null;
  const people = roster(eventId);
  const byId = Object.fromEntries(people.map((p) => [p.id, p]));
  const scores = scoresFor(eventId).filter((s) => byId[s.personId]);
  const disciplines = (ev.disciplines || []).filter((d) => d.on);
  const out = { disciplines: [], patrols: [] };
  const patrolMap = new Map();
  // shooters with neither a patrol nor a troop are ranked as individuals only
  const noTeam = (p) => !(p.patrol || "").trim() && !(p.troop || "").trim();
  out.unassigned = people.filter(noTeam);
  for (const p of people) {
    if (noTeam(p)) continue;
    const k = teamKey(p);
    if (!patrolMap.has(k)) patrolMap.set(k, { key: k, troop: p.troop, patrol: p.patrol, label: team(p), members: 0, by: {} });
    patrolMap.get(k).members++;
  }
  for (const d of disciplines) {
    const indiv = [];
    let hasCoins = false;
    for (const p of people) {
      const mine = scores.filter((s) => s.personId === p.id && s.disciplineId === d.id);
      const vals = mine.map((s) => s.value).filter((v) => typeof v === "number" && isFinite(v));
      const v = combine(vals, d.rule, d.kind);
      // merit badge (quarter) and dime club passes, .22 groups only
      const coin = mine.filter((s) => typeof s.quarter === "boolean");
      const coins = coin.length ? { groups: coin.length, quarter: coin.filter((s) => s.quarter).length, dime: coin.filter((s) => s.dime).length } : null;
      if (coins) hasCoins = true;
      if (v != null) indiv.push({ person: p, value: v, entries: vals.length, coins });
    }
    indiv.sort((a, b) => (d.kind === "group" ? a.value - b.value : b.value - a.value));
    let rank = 0, prev = null;
    indiv.forEach((r, i) => { if (prev === null || r.value !== prev) rank = i + 1; r.rank = rank; prev = r.value; });

    // patrol average for this discipline
    const pat = new Map();
    for (const r of indiv) {
      if (noTeam(r.person)) continue;
      const k = teamKey(r.person);
      if (!pat.has(k)) pat.set(k, []);
      pat.get(k).push(r.value);
    }
    const avgs = [...pat.entries()].map(([k, v]) => ({ k, avg: v.reduce((a, b) => a + b, 0) / v.length, n: v.length }));
    const best = avgs.length ? (d.kind === "group" ? Math.min(...avgs.map((a) => a.avg)) : Math.max(...avgs.map((a) => a.avg))) : null;
    for (const a of avgs) {
      let pts = 0;
      if (d.kind === "group") pts = a.avg > 0 ? (100 * best) / a.avg : 100;
      else pts = best > 0 ? (100 * a.avg) / best : 0;
      patrolMap.get(a.k).by[d.id] = { avg: a.avg, shooters: a.n, points: pts };
    }
    out.disciplines.push({ discipline: d, individuals: indiv, hasCoins });
  }
  const patrols = [...patrolMap.values()].map((p) => {
    p.total = disciplines.reduce((s, d) => s + (p.by[d.id] ? p.by[d.id].points : 0), 0);
    return p;
  });
  patrols.sort((a, b) => b.total - a.total);
  let rank = 0, prev = null;
  patrols.forEach((p, i) => { const t = Math.round(p.total * 10) / 10; if (prev === null || t !== prev) rank = i + 1; p.rank = rank; prev = t; });
  out.patrols = patrols;
  out.event = ev;
  return out;
}

// ------------------------------------------------------------------ sync

export function pendingCount() {
  let n = 0;
  for (const t of ["events", "people", "scores"]) for (const r of Object.values(db[t])) if (r.dirty) n++;
  return n;
}

const TABLE = { event: "events", person: "people", score: "scores" };

export async function sync() {
  const url = (db.settings.syncUrl || "").trim();
  if (!url) return { ok: false, reason: "no-url" };
  const records = [];
  for (const t of ["events", "people", "scores"]) for (const r of Object.values(db[t])) if (r.dirty) { const { dirty, ...rest } = r; records.push(rest); }
  const sentAt = {};
  records.forEach((r) => { sentAt[r.id] = r.updated; });
  let res;
  try {
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" }, // keeps the request simple for Google
      body: JSON.stringify({ action: "sync", since: db.lastSync, records }),
    });
    res = await resp.json();
  } catch (e) {
    return { ok: false, reason: "offline" };
  }
  if (!res || !res.ok) return { ok: false, reason: (res && res.error) || "server" };
  // our changes are saved on the sheet
  for (const r of records) {
    const t = TABLE[r.type];
    const cur = db[t][r.id];
    if (cur && cur.updated === sentAt[r.id]) cur.dirty = false;
  }
  // take everyone else's newer changes
  for (const r of res.records || []) {
    const t = TABLE[r.type];
    if (!t) continue;
    const cur = db[t][r.id];
    if (!cur || (!cur.dirty && (r.updated || "") >= (cur.updated || ""))) db[t][r.id] = r;
  }
  db.lastSync = res.serverTime || now();
  save();
  return { ok: true, sent: records.length, received: (res.records || []).length };
}
