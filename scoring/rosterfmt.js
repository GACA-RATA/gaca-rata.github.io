// The organizer sheet: what an event organizer sends so instructors can load
// patrols, participants and report times without typing them in.
// Shared by organizer.html (makes the QR codes) and the app (reads them).
//
// payload = {
//   v: 1, name, date, location,
//   kind: "camporee" | "merit",
//   ranges: ["rifle", "shotgun", "archery", "pistol"],   // camporee ranges in use
//   patrols: [{ troop, patrol, count, times: { rifle: "09:30", ... } }],  // camporee
//   scouts: [{ name, troop }],                                           // merit badge
// }

export const RANGES = [
  { id: "rifle", name: "Rifle" },
  { id: "shotgun", name: "Shotgun" },
  { id: "archery", name: "Archery" },
  { id: "pistol", name: "Pistol" },
];

const TAG = "RATA1";
const PART = 520; // characters per QR code, small enough to scan easily from a printed page

// Compact text so a big camporee fits in a few codes:
//   line 1: "2" | name | date | location | c or m | rifle,shotgun,...
//   camporee lines: troop | patrol | count | 0930,1030,1300 (times in the range order)
//   merit badge lines: name | troop
const clean = (x) => String(x ?? "").replace(/[|\r\n]/g, " ").trim();
const hhmm = (t) => { const m = minutes(t); return m == null ? "" : String(Math.floor(m / 60)).padStart(2, "0") + String(m % 60).padStart(2, "0"); };
function pack(p) {
  const ranges = p.ranges || [];
  const lines = [["2", clean(p.name), clean(p.date), clean(p.location), p.kind === "merit" ? "m" : "c", ranges.join(",")].join("|")];
  if (p.kind === "merit") for (const x of p.scouts || []) lines.push([clean(x.name), clean(x.troop)].join("|"));
  else for (const x of p.patrols || []) lines.push([clean(x.troop), clean(x.patrol), Number(x.count) || 0, ranges.map((r) => hhmm(x.times?.[r])).join(",")].join("|"));
  return lines.join("\n");
}
function unpack2(text) {
  const [head, ...rows] = text.split("\n");
  const h = head.split("|");
  const kind = h[4] === "m" ? "merit" : "camporee";
  const ranges = (h[5] || "").split(",").filter(Boolean);
  const out = { v: 1, name: h[1] || "", date: h[2] || "", location: h[3] || "", kind, ranges, patrols: [], scouts: [] };
  for (const r of rows) {
    const c = r.split("|");
    if (kind === "merit") { if (c[0]) out.scouts.push({ name: c[0], troop: c[1] || "" }); continue; }
    const t = (c[3] || "").split(",");
    const times = {};
    ranges.forEach((id, i) => { if (/^\d{4}$/.test(t[i] || "")) times[id] = t[i].slice(0, 2) + ":" + t[i].slice(2); });
    out.patrols.push({ troop: c[0] || "", patrol: c[1] || "", count: Number(c[2]) || 0, times });
  }
  return out;
}

// Version 1 (JSON), kept so older printed sheets still read.
function packJson(p) {
  return JSON.stringify({
    v: 1, n: p.name || "", d: p.date || "", l: p.location || "", k: p.kind === "merit" ? "m" : "c",
    r: p.ranges || [],
    p: (p.patrols || []).map((x) => [x.troop || "", x.patrol || "", Number(x.count) || 0, x.times || {}]),
    s: (p.scouts || []).map((x) => [x.name || "", x.troop || ""]),
  });
}
function unpack(text) {
  if (text.startsWith("2|")) return unpack2(text);
  const o = JSON.parse(text);
  if (o.v !== 1) throw new Error("This code is from a newer version of the form.");
  return {
    v: 1, name: o.n || "", date: o.d || "", location: o.l || "", kind: o.k === "m" ? "merit" : "camporee",
    ranges: Array.isArray(o.r) ? o.r : [],
    patrols: (o.p || []).map((x) => ({ troop: String(x[0] || ""), patrol: String(x[1] || ""), count: Number(x[2]) || 0, times: x[3] || {} })),
    scouts: (o.s || []).map((x) => ({ name: String(x[0] || ""), troop: String(x[1] || "") })),
  };
}

// Split into QR-sized parts: "RATA1 2/3 <text>". Every part carries the same id.
export function encodeParts(payload) {
  const body = pack(payload);
  const id = Math.random().toString(36).slice(2, 6);
  const n = Math.max(1, Math.ceil(body.length / PART));
  const out = [];
  for (let i = 0; i < n; i++) out.push(`${TAG} ${id} ${i + 1}/${n} ${body.slice(i * PART, (i + 1) * PART)}`);
  return out;
}

// Read one scanned code. Returns { id, index, total, text } or null if it isn't ours.
export function readPart(raw) {
  const m = /^RATA1 (\w+) (\d+)\/(\d+) ([\s\S]*)$/.exec(String(raw || ""));
  if (!m) return null;
  return { id: m[1], index: +m[2], total: +m[3], text: m[4] };
}

// Join parts (an object index -> text) once all are in.
export function joinParts(parts, total) {
  let s = "";
  for (let i = 1; i <= total; i++) {
    if (parts[i] == null) return null;
    s += parts[i];
  }
  return unpack(s);
}

// Times: accept "09:30", "9:30", "9:30 AM", "1:15pm". Returns minutes after midnight or null.
export function minutes(t) {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*([ap])?\.?\s*m?\.?\s*$/i.exec(String(t || ""));
  if (!m) return null;
  let h = +m[1];
  const mm = +(m[2] || 0);
  const ap = (m[3] || "").toLowerCase();
  if (ap === "p" && h < 12) h += 12;
  if (ap === "a" && h === 12) h = 0;
  if (h > 23 || mm > 59) return null;
  return h * 60 + mm;
}
export function clock(t) {
  const v = minutes(t);
  if (v == null) return String(t || "");
  const h = Math.floor(v / 60), m = v % 60;
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

// Read the Excel template (rows from SheetJS, header:1, raw:false).
// sheets: { [sheetName]: rows[][] }. Returns a payload.
export function fromSheets(sheets) {
  const find = (re) => Object.keys(sheets).find((k) => re.test(k));
  const cell = (v) => String(v ?? "").trim();
  const out = { v: 1, name: "", date: "", location: "", kind: "camporee", ranges: [], patrols: [], scouts: [] };
  const evName = find(/^event/i);
  if (evName) for (const row of sheets[evName]) {
    const k = cell(row[0]).toLowerCase(), v = cell(row[1]);
    if (/^event name/.test(k)) out.name = v;
    else if (/^date/.test(k)) out.date = v;
    else if (/^location/.test(k)) out.location = v;
    else if (/^type/.test(k)) out.kind = /merit/i.test(v) ? "merit" : "camporee";
  }
  const pat = find(/patrol/i);
  if (pat) {
    const rows = sheets[pat];
    const hi = rows.findIndex((r) => r.some((c) => /^troop$/i.test(cell(c))) && r.some((c) => /^patrol$/i.test(cell(c))));
    if (hi >= 0) {
      const head = rows[hi].map((c) => cell(c).toLowerCase());
      const col = (re) => head.findIndex((h) => re.test(h));
      const ct = col(/^troop$/), cp = col(/^patrol$/), cn = col(/participants|scouts|how many/);
      const rangeCols = RANGES.map((r) => ({ id: r.id, c: col(new RegExp("^" + r.name.toLowerCase())) })).filter((x) => x.c >= 0);
      for (const r of rows.slice(hi + 1)) {
        const troop = cell(r[ct]), patrol = cell(r[cp]);
        if (!troop && !patrol) continue;
        if (r.some((c) => /example/i.test(cell(c)))) continue; // the template's sample row
        const times = {};
        for (const rc of rangeCols) { const t = cell(r[rc.c]); if (t) times[rc.id] = t; }
        out.patrols.push({ troop, patrol, count: Math.max(0, Math.min(30, parseInt(cell(r[cn]), 10) || 0)), times });
      }
      out.ranges = rangeCols.filter((rc) => out.patrols.some((p) => p.times[rc.id])).map((rc) => rc.id);
    }
  }
  const sc = find(/merit|scout/i);
  if (sc) {
    const rows = sheets[sc];
    const hi = rows.findIndex((r) => r.some((c) => /first/i.test(cell(c))));
    if (hi >= 0) {
      const head = rows[hi].map((c) => cell(c).toLowerCase());
      const cf = head.findIndex((h) => /first/.test(h)), cl = head.findIndex((h) => /last/.test(h)), ct = head.findIndex((h) => /troop/.test(h));
      for (const r of rows.slice(hi + 1)) {
        const first = cell(r[cf]);
        if (!first) continue;
        if (r.some((c) => /example/i.test(cell(c)))) continue; // the template's sample row
        const last = cl >= 0 ? cell(r[cl]).replace(/\./g, "") : "";
        out.scouts.push({ name: last ? `${first} ${last.charAt(0).toUpperCase()}.` : first, troop: ct >= 0 ? cell(r[ct]) : "" });
      }
    }
  }
  if (out.scouts.length && !out.patrols.length) out.kind = "merit";
  return out;
}
