// Georgia-Carolina Council RATA — group scoring engine.
// Pure image math; no DOM. Every function works on {width, height, data}
// (RGBA Uint8ClampedArray), so it runs in the browser and in Node tests.
//
// Pipeline
//   1. Find the target sheet against the backer (a colored board behind it).
//   2. Square the sheet up (perspective correction) so an angled photo
//      measures the same as a straight-on one.
//   3. Find holes: pixels where the backer color shows through the paper.
//   4. Scale: clean single holes have a known size (caliber), so their size in
//      pixels gives pixels-per-inch. A known sheet size is the cross-check and
//      the fallback when every hole in the group is torn together.
//   5. Place shot centers (fitting true-size circles into ragged holes),
//      split holes into groups, and measure each group.

export const COINS = {
  dime: { label: "Dime", diaIn: 0.705 },
  quarter: { label: "Quarter", diaIn: 0.955 },
};

export const CALIBERS = [
  { id: "22lr", label: ".22 LR", diaIn: 0.223 },
  { id: "9mm", label: "9mm", diaIn: 0.355 },
  { id: "177", label: ".177 pellet", diaIn: 0.177 },
  { id: "38", label: ".38 / .357", diaIn: 0.357 },
  { id: "45", label: ".45 ACP", diaIn: 0.452 },
];

// ---------------------------------------------------------------- color

function ycc(r, g, b) {
  const y = 0.299 * r + 0.587 * g + 0.114 * b;
  return [y, b - y, r - y];
}
// Brightness counts half as much as color so uneven light on the backer
// matters less than its hue.
function cdist(a, b) {
  const dy = 0.5 * (a[0] - b[0]);
  const d1 = a[1] - b[1];
  const d2 = a[2] - b[2];
  return Math.sqrt(dy * dy + d1 * d1 + d2 * d2);
}
function median(arr) {
  if (!arr.length) return NaN;
  const s = Float64Array.from(arr).sort();
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

// ---------------------------------------------------------------- resize

export function downscale(img, maxEdge) {
  const k = Math.min(1, maxEdge / Math.max(img.width, img.height));
  if (k === 1) return { img, k: 1 };
  const w = Math.max(1, Math.round(img.width * k));
  const h = Math.max(1, Math.round(img.height * k));
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = img.width / w;
  const sy = img.height / h;
  const src = img.data;
  const W = img.width;
  for (let y = 0; y < h; y++) {
    const y0 = Math.floor(y * sy);
    const y1 = Math.min(img.height, Math.max(y0 + 1, Math.floor((y + 1) * sy)));
    for (let x = 0; x < w; x++) {
      const x0 = Math.floor(x * sx);
      const x1 = Math.min(W, Math.max(x0 + 1, Math.floor((x + 1) * sx)));
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = y0; yy < y1; yy += 1) {
        let p = (yy * W + x0) * 4;
        for (let xx = x0; xx < x1; xx += 1, p += 4) {
          r += src[p]; g += src[p + 1]; b += src[p + 2]; n++;
        }
      }
      const o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { img: { width: w, height: h, data: out }, k };
}

// ---------------------------------------------------------------- colors of paper and backer

function estimateColors(img) {
  const { width: w, height: h, data } = img;
  // Paper: brighter half of the middle of the photo.
  const center = [];
  for (let y = Math.floor(h * 0.3); y < h * 0.7; y += 2)
    for (let x = Math.floor(w * 0.3); x < w * 0.7; x += 2) {
      const p = (y * w + x) * 4;
      center.push(ycc(data[p], data[p + 1], data[p + 2]));
    }
  const ymed = median(center.map((c) => c[0]));
  const bright = center.filter((c) => c[0] >= ymed);
  const paper = [0, 1, 2].map((i) => median(bright.map((c) => c[i])));

  // Backer: the outer band of the photo, keeping the pixels least like paper.
  const band = [];
  const bw = Math.max(2, Math.round(Math.min(w, h) * 0.04));
  for (let y = 0; y < h; y += 2)
    for (let x = 0; x < w; x += 2) {
      if (x >= bw && x < w - bw && y >= bw && y < h - bw) continue;
      const p = (y * w + x) * 4;
      band.push(ycc(data[p], data[p + 1], data[p + 2]));
    }
  band.sort((a, b) => cdist(b, paper) - cdist(a, paper));
  const far = band.slice(0, Math.max(10, Math.floor(band.length * 0.3)));
  const backer = [0, 1, 2].map((i) => median(far.map((c) => c[i])));
  return { paper, backer };
}

// ---------------------------------------------------------------- connected regions

function largestComponent(mask, w, h) {
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  let best = -1, bestArea = 0, id = 0;
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    let sp = 0, area = 0;
    stack[sp++] = i; label[i] = id;
    while (sp) {
      const q = stack[--sp]; area++;
      const x = q % w, y = (q / w) | 0;
      if (x > 0 && mask[q - 1] && label[q - 1] === -1) { label[q - 1] = id; stack[sp++] = q - 1; }
      if (x < w - 1 && mask[q + 1] && label[q + 1] === -1) { label[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && mask[q - w] && label[q - w] === -1) { label[q - w] = id; stack[sp++] = q - w; }
      if (y < h - 1 && mask[q + w] && label[q + w] === -1) { label[q + w] = id; stack[sp++] = q + w; }
    }
    if (area > bestArea) { bestArea = area; best = id; }
    id++;
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) if (label[i] === best) out[i] = 1;
  return { mask: out, area: bestArea };
}

// ---------------------------------------------------------------- geometry

function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
function convexHull(pts) {
  const p = pts.slice().sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  up.pop(); lo.pop();
  return lo.concat(up);
}
function polyArea(q) {
  let a = 0;
  for (let i = 0; i < q.length; i++) { const p = q[i], n = q[(i + 1) % q.length]; a += p[0] * n[1] - n[0] * p[1]; }
  return Math.abs(a) / 2;
}
function maxAreaQuad(hull) {
  const n = hull.length;
  if (n < 4) return null;
  // start from the four extreme points, then improve one corner at a time
  const score = [(p) => -(p[0] + p[1]), (p) => p[0] - p[1], (p) => p[0] + p[1], (p) => p[1] - p[0]];
  let idx = score.map((f) => { let bi = 0; for (let i = 1; i < n; i++) if (f(hull[i]) > f(hull[bi])) bi = i; return bi; });
  idx.sort((a, b) => a - b);
  let best = polyArea(idx.map((i) => hull[i]));
  for (let iter = 0; iter < 20; iter++) {
    let improved = false;
    for (let k = 0; k < 4; k++) {
      for (let c = 0; c < n; c++) {
        if (idx.includes(c)) continue;
        const t = idx.slice(); t[k] = c; t.sort((a, b) => a - b);
        const a = polyArea(t.map((i) => hull[i]));
        if (a > best + 1e-9) { best = a; idx = t; improved = true; }
      }
    }
    if (!improved) break;
  }
  return idx.map((i) => hull[i]);
}
function orderCorners(q) {
  const cx = q.reduce((s, p) => s + p[0], 0) / 4, cy = q.reduce((s, p) => s + p[1], 0) / 4;
  const s = q.slice().sort((a, b) => Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx));
  let start = 0;
  for (let i = 1; i < 4; i++) if (s[i][0] + s[i][1] < s[start][0] + s[start][1]) start = i;
  return [0, 1, 2, 3].map((i) => s[(start + i) % 4]); // TL, TR, BR, BL (y down)
}
function fitLine(pts) {
  const n = pts.length;
  let mx = 0, my = 0;
  for (const p of pts) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (const p of pts) { const dx = p[0] - mx, dy = p[1] - my; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(th), dy: Math.sin(th) };
}
function intersect(a, b) {
  const det = a.dx * -b.dy - a.dy * -b.dx;
  if (Math.abs(det) < 1e-9) return null;
  const t = ((b.px - a.px) * -b.dy - (b.py - a.py) * -b.dx) / det;
  return [a.px + t * a.dx, a.py + t * a.dy];
}

// Corners of the sheet in full-resolution photo coordinates.
export function findSheet(img) {
  const { img: sm, k } = downscale(img, 900);
  const { width: w, height: h, data } = sm;
  const { paper, backer } = estimateColors(sm);
  const sep = cdist(paper, backer);
  const T = sep * 0.5;
  const mask = new Uint8Array(w * h);
  for (let i = 0, p = 0; i < w * h; i++, p += 4) {
    if (cdist(ycc(data[p], data[p + 1], data[p + 2]), backer) > T) mask[i] = 1;
  }
  const comp = largestComponent(mask, w, h);
  const warnings = [];
  if (sep < 40) warnings.push("The backer and the paper look alike. Put a bright colored board behind the target.");
  if (Math.hypot(backer[1], backer[2]) < 25)
    warnings.push("The backer looks gray or black. Holes in black print are easier to find with a bright colored backer.");
  if (comp.area < w * h * 0.08) return { ok: false, warnings: ["Could not find the target sheet. Lay it flat on the backer with some backer showing on every side."], paper, backer };

  // edge pixels of the sheet region: left-most and right-most per row, top/bottom per column
  const edge = [];
  for (let y = 0; y < h; y++) {
    let l = -1, r = -1;
    for (let x = 0; x < w; x++) if (comp.mask[y * w + x]) { if (l < 0) l = x; r = x; }
    if (l >= 0) { edge.push([l, y]); edge.push([r, y]); }
  }
  for (let x = 0; x < w; x++) {
    let t = -1, b = -1;
    for (let y = 0; y < h; y++) if (comp.mask[y * w + x]) { if (t < 0) t = y; b = y; }
    if (t >= 0) { edge.push([x, t]); edge.push([x, b]); }
  }
  const hull = convexHull(edge);
  let quad = maxAreaQuad(hull);
  if (!quad) return { ok: false, warnings: ["Could not find the corners of the target sheet."], paper, backer };
  quad = orderCorners(quad);

  // refine: fit a straight line to the edge pixels along each side (ignoring the ends)
  const lines = [];
  for (let s = 0; s < 4; s++) {
    const a = quad[s], b = quad[(s + 1) % 4];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const ux = (b[0] - a[0]) / L, uy = (b[1] - a[1]) / L;
    const tol = Math.max(2, L * 0.012);
    const near = edge.filter((p) => {
      const vx = p[0] - a[0], vy = p[1] - a[1];
      const t = vx * ux + vy * uy;
      const d = Math.abs(vx * uy - vy * ux);
      return t > L * 0.12 && t < L * 0.88 && d < tol;
    });
    lines.push(near.length > 10 ? fitLine(near) : { px: a[0], py: a[1], dx: ux, dy: uy });
  }
  const refined = [];
  for (let s = 0; s < 4; s++) {
    const p = intersect(lines[(s + 3) % 4], lines[s]);
    refined.push(p && Math.hypot(p[0] - quad[s][0], p[1] - quad[s][1]) < Math.min(w, h) * 0.05 ? p : quad[s]);
  }
  const corners = refined.map((p) => [(p[0] + 0.5) / k - 0.5, (p[1] + 0.5) / k - 0.5]);
  const touches = corners.some((p) => p[0] < 2 / k || p[1] < 2 / k || p[0] > img.width - 1 - 2 / k || p[1] > img.height - 1 - 2 / k);
  if (touches) warnings.push("The sheet runs off the edge of the photo. Step back so all four corners show.");
  return { ok: true, corners, paper, backer, warnings };
}

// ---------------------------------------------------------------- perspective

function solve(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    [M[c], M[piv]] = [M[piv], M[c]];
    if (Math.abs(M[c][c]) < 1e-12) return null;
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}
// Homography H with H * [u v 1] ~ [x y 1] for the 4 pairs src(u,v) -> dst(x,y).
export function homography(src, dst) {
  const A = [], b = [];
  for (let i = 0; i < 4; i++) {
    const [u, v] = src[i], [x, y] = dst[i];
    A.push([u, v, 1, 0, 0, 0, -u * x, -v * x]); b.push(x);
    A.push([0, 0, 0, u, v, 1, -u * y, -v * y]); b.push(y);
  }
  const h = solve(A, b);
  return h ? [...h, 1] : null;
}
export function applyH(H, x, y) {
  const d = H[6] * x + H[7] * y + H[8];
  return [(H[0] * x + H[1] * y + H[2]) / d, (H[3] * x + H[4] * y + H[5]) / d];
}

function sideLengths(c) {
  const d = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  return { w: (d(c[0], c[1]) + d(c[3], c[2])) / 2, h: (d(c[0], c[3]) + d(c[1], c[2])) / 2 };
}

// Square the sheet up into a w x h image (rect -> photo mapping with supersampling).
export function warp(img, corners, w, h) {
  const dst = [[0, 0], [w, 0], [w, h], [0, h]];
  const H = homography(dst, corners); // output -> photo
  const out = new Uint8ClampedArray(w * h * 4);
  const { w: sw, h: shh } = sideLengths(corners);
  const ss = Math.max(sw / w, shh / h) > 1.6 ? 2 : 1;
  const src = img.data, W = img.width, Hh = img.height;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0;
      for (let sy = 0; sy < ss; sy++)
        for (let sx = 0; sx < ss; sx++) {
          const ox = x + (sx + 0.5) / ss, oy = y + (sy + 0.5) / ss;
          const d = H[6] * ox + H[7] * oy + H[8];
          let px = (H[0] * ox + H[1] * oy + H[2]) / d - 0.5;
          let py = (H[3] * ox + H[4] * oy + H[5]) / d - 0.5;
          px = Math.max(0, Math.min(W - 1.001, px)); py = Math.max(0, Math.min(Hh - 1.001, py));
          const x0 = px | 0, y0 = py | 0, fx = px - x0, fy = py - y0;
          const p00 = (y0 * W + x0) * 4, p10 = p00 + 4, p01 = p00 + W * 4, p11 = p01 + 4;
          const w00 = (1 - fx) * (1 - fy), w10 = fx * (1 - fy), w01 = (1 - fx) * fy, w11 = fx * fy;
          r += src[p00] * w00 + src[p10] * w10 + src[p01] * w01 + src[p11] * w11;
          g += src[p00 + 1] * w00 + src[p10 + 1] * w10 + src[p01 + 1] * w01 + src[p11 + 1] * w11;
          b += src[p00 + 2] * w00 + src[p10 + 2] * w10 + src[p01 + 2] * w01 + src[p11 + 2] * w11;
        }
      const n = ss * ss, o = (y * w + x) * 4;
      out[o] = r / n; out[o + 1] = g / n; out[o + 2] = b / n; out[o + 3] = 255;
    }
  }
  return { width: w, height: h, data: out };
}

// ---------------------------------------------------------------- holes

export function holeBlobs(rect, backer, paper) {
  const { width: w, height: h, data } = rect;
  const dark = [paper[0] * 0.12, 0, 0];
  const T = 0.5 * Math.min(cdist(paper, backer), cdist(dark, backer));
  const raw = new Uint8Array(w * h);
  const m = Math.round(Math.min(w, h) * 0.012);
  for (let y = m; y < h - m; y++)
    for (let x = m; x < w - m; x++) {
      const p = (y * w + x) * 4;
      if (cdist(ycc(data[p], data[p + 1], data[p + 2]), backer) < T) raw[y * w + x] = 1;
    }
  // remove single-pixel specks (a pixel stays if at least 2 of its 4 neighbors agree)
  const mask = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++)
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (!raw[i]) continue;
      if (raw[i - 1] + raw[i + 1] + raw[i - w] + raw[i + w] >= 2) mask[i] = 1;
    }
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const blobs = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    const id = blobs.length;
    const px = [];
    let sp = 0;
    stack[sp++] = i; label[i] = id;
    let sx = 0, sy = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    while (sp) {
      const q = stack[--sp];
      const x = q % w, y = (q / w) | 0;
      px.push(q); sx += x; sy += y;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[q - 1] && label[q - 1] === -1) { label[q - 1] = id; stack[sp++] = q - 1; }
      if (x < w - 1 && mask[q + 1] && label[q + 1] === -1) { label[q + 1] = id; stack[sp++] = q + 1; }
      if (y > 0 && mask[q - w] && label[q - w] === -1) { label[q - w] = id; stack[sp++] = q - w; }
      if (y < h - 1 && mask[q + w] && label[q + w] === -1) { label[q + w] = id; stack[sp++] = q + w; }
    }
    const n = px.length;
    if (n < 12) continue;
    const cx = sx / n, cy = sy / n;
    let sxx = 0, syy = 0, sxy = 0;
    for (const q of px) { const dx = (q % w) - cx, dy = ((q / w) | 0) - cy; sxx += dx * dx; syy += dy * dy; sxy += dx * dy; }
    sxx /= n; syy /= n; sxy /= n;
    const tr = sxx + syy, det = sxx * syy - sxy * sxy;
    const disc = Math.sqrt(Math.max(0, tr * tr / 4 - det));
    const l1 = tr / 2 + disc, l2 = Math.max(1e-6, tr / 2 - disc);
    const a = 2 * Math.sqrt(l1), b = 2 * Math.sqrt(l2); // semi-axes of the equivalent ellipse
    blobs.push({
      id, px, area: n, cx: cx + 0.5, cy: cy + 0.5,
      sxx, syy, sxy, ratio: b / a, fill: n / (Math.PI * a * b), eqDia: 2 * Math.sqrt(n / Math.PI),
      minX, maxX, minY, maxY,
    });
  }
  return { blobs, mask, w, h };
}

// Pick out clean, single, round holes — the ones whose size we can trust.
function singleHoles(blobs, expectPx) {
  let c = blobs.filter((b) => b.ratio > 0.75 && b.fill > 0.88 && b.fill < 1.12);
  if (expectPx) c = c.filter((b) => b.eqDia > expectPx * 0.7 && b.eqDia < expectPx * 1.3);
  if (!c.length) return [];
  // largest set of holes that agree in size within ±25%, ties go to smaller
  let best = [];
  for (const ref of c) {
    const g = c.filter((b) => b.eqDia > ref.eqDia * 0.8 && b.eqDia < ref.eqDia * 1.25);
    if (g.length > best.length || (g.length === best.length && median(g.map((x) => x.eqDia)) < median(best.map((x) => x.eqDia)))) best = g;
  }
  // a lone "hole" with no sheet size to check against is accepted only if round and full
  return best;
}

// ---------------------------------------------------------------- placing shots inside ragged holes

function fitCircles(blob, k, rPx, w) {
  const pad = Math.ceil(rPx) + 2;
  const x0 = blob.minX - pad, y0 = blob.minY - pad;
  const gw = blob.maxX - blob.minX + 1 + 2 * pad, gh = blob.maxY - blob.minY + 1 + 2 * pad;
  const inBlob = new Uint8Array(gw * gh);
  for (const q of blob.px) { const x = (q % w) - x0, y = ((q / w) | 0) - y0; inBlob[y * gw + x] = 1; }
  // start: k-means on the blob pixels, seeded with far-apart points
  const pts = blob.px.map((q) => [(q % w) + 0.5, ((q / w) | 0) + 0.5]);
  let C = [[blob.cx, blob.cy]];
  while (C.length < k) {
    let bi = 0, bd = -1;
    for (let i = 0; i < pts.length; i += 3) {
      let d = Infinity; for (const c of C) d = Math.min(d, (pts[i][0] - c[0]) ** 2 + (pts[i][1] - c[1]) ** 2);
      if (d > bd) { bd = d; bi = i; }
    }
    C.push(pts[bi].slice());
  }
  for (let it = 0; it < 8 && k > 1; it++) {
    const s = C.map(() => [0, 0, 0]);
    for (const p of pts) {
      let bi = 0, bd = Infinity;
      C.forEach((c, i) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
      s[bi][0] += p[0]; s[bi][1] += p[1]; s[bi][2]++;
    }
    C = C.map((c, i) => (s[i][2] ? [s[i][0] / s[i][2], s[i][1] / s[i][2]] : c));
  }
  // refine: move true-size circles so they cover the hole and as little paper as possible
  const r2 = rPx * rPx;
  const cost = (Cs) => {
    let e = 0;
    for (let y = 0; y < gh; y++)
      for (let x = 0; x < gw; x++) {
        const X = x + x0 + 0.5, Y = y + y0 + 0.5;
        let cov = false;
        for (const c of Cs) if ((X - c[0]) ** 2 + (Y - c[1]) ** 2 <= r2) { cov = true; break; }
        if (cov !== !!inBlob[y * gw + x]) e++;
      }
    return e;
  };
  let cur = cost(C);
  const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  for (let step = rPx / 2; step >= 0.5; step /= 2) {
    for (let pass = 0; pass < 4; pass++) {
      let moved = false;
      for (let i = 0; i < C.length; i++)
        for (const [dx, dy] of dirs) {
          const T = C.map((c) => c.slice()); T[i][0] += dx * step; T[i][1] += dy * step;
          const e = cost(T);
          if (e < cur) { cur = e; C = T; moved = true; }
        }
      if (!moved) break;
    }
  }
  return C;
}

// ---------------------------------------------------------------- group math (inches)

function mec(points) {
  // smallest circle around the points (Welzl, iterative)
  const P = points.map((p) => [p.x, p.y]);
  for (let i = P.length - 1; i > 0; i--) { const j = Math.floor(((i * 2654435761) % 4294967296) / 4294967296 * (i + 1)); [P[i], P[j]] = [P[j], P[i]]; }
  const circ2 = (a, b) => ({ x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, r: Math.hypot(a[0] - b[0], a[1] - b[1]) / 2 });
  const circ3 = (a, b, c) => {
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) {
      const cs = [circ2(a, b), circ2(a, c), circ2(b, c)];
      return cs.reduce((m, x) => (x.r > m.r ? x : m));
    }
    const A = a[0] ** 2 + a[1] ** 2, B = b[0] ** 2 + b[1] ** 2, Cc = c[0] ** 2 + c[1] ** 2;
    const x = (A * (b[1] - c[1]) + B * (c[1] - a[1]) + Cc * (a[1] - b[1])) / d;
    const y = (A * (c[0] - b[0]) + B * (a[0] - c[0]) + Cc * (b[0] - a[0])) / d;
    return { x, y, r: Math.hypot(a[0] - x, a[1] - y) };
  };
  const inside = (c, p) => Math.hypot(p[0] - c.x, p[1] - c.y) <= c.r + 1e-9;
  if (!P.length) return { x: 0, y: 0, r: 0 };
  let c = { x: P[0][0], y: P[0][1], r: 0 };
  for (let i = 1; i < P.length; i++) {
    if (inside(c, P[i])) continue;
    c = { x: P[i][0], y: P[i][1], r: 0 };
    for (let j = 0; j < i; j++) {
      if (inside(c, P[j])) continue;
      c = circ2(P[i], P[j]);
      for (let k = 0; k < j; k++) if (!inside(c, P[k])) c = circ3(P[i], P[j], P[k]);
    }
  }
  return c;
}

// shots: [{x, y}] in inches. holeDiaIn: diameter of one hole on the paper.
export function groupMetrics(shots, holeDiaIn) {
  const n = shots.length;
  const rh = holeDiaIn / 2;
  if (!n) return { n: 0 };
  let es = 0, pair = null;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(shots[i].x - shots[j].x, shots[i].y - shots[j].y);
      if (d > es) { es = d; pair = [i, j]; }
    }
  const cx = shots.reduce((s, p) => s + p.x, 0) / n, cy = shots.reduce((s, p) => s + p.y, 0) / n;
  const meanRadius = shots.reduce((s, p) => s + Math.hypot(p.x - cx, p.y - cy), 0) / n;
  const c = mec(shots);
  const dimeR = COINS.dime.diaIn / 2, quarterR = COINS.quarter.diaIn / 2;
  return {
    n,
    spreadIn: es, // center to center
    outsideIn: n ? es + holeDiaIn : 0, // edge to edge
    pair,
    center: { x: cx, y: cy },
    meanRadiusIn: meanRadius,
    circle: c,
    // Dime club: a dime covers every hole completely.
    dime: { pass: c.r + rh <= dimeR + 1e-9, marginIn: dimeR - (c.r + rh) },
    // Merit badge: a quarter touches every hole.
    quarter: { pass: c.r <= quarterR + rh + 1e-9, marginIn: quarterR + rh - c.r },
  };
}

// ---------------------------------------------------------------- the whole thing

/**
 * img: full-resolution photo {width, height, data}
 * opts: {
 *   caliberIn: nominal bullet diameter (in),
 *   holeFactor: hole on paper ÷ bullet diameter (default 1),
 *   shotsPerGroup: expected shots per group (default 5),
 *   sheet: {w, h} in inches if the sheet size is known, else null,
 *   corners: optional [[x,y] x4] (TL, TR, BR, BL) to skip auto sheet finding,
 *   ppi: working resolution of the squared-up image (default 120)
 * }
 */
export function analyze(img, opts) {
  const caliberIn = opts.caliberIn;
  const holeIn = caliberIn * (opts.holeFactor || 1);
  const perGroup = opts.shotsPerGroup || 5;
  const sheet = opts.sheet && opts.sheet.w > 0 && opts.sheet.h > 0 ? opts.sheet : null;
  const warnings = [];

  const found = findSheet(img);
  const colors = { paper: found.paper, backer: found.backer };
  let corners = opts.corners || (found.ok ? found.corners : null);
  if (!opts.corners) warnings.push(...found.warnings);
  if (!corners) return { ok: false, stage: "sheet", warnings, colors };

  // size of the squared-up image
  const sl = sideLengths(corners);
  let aspect; // width ÷ height of the sheet
  if (sheet) {
    const landscape = sl.w > sl.h;
    const long = Math.max(sheet.w, sheet.h), short = Math.min(sheet.w, sheet.h);
    aspect = landscape ? long / short : short / long;
  } else aspect = sl.w / sl.h;
  // work at about opts.ppi pixels per inch; without a sheet size, guess the scale from the photo size
  const targetPpi = opts.ppi || 120;
  let outW, outH;
  const sizeFor = (asp) => {
    if (sheet) {
      const wIn = asp >= 1 ? Math.max(sheet.w, sheet.h) : Math.min(sheet.w, sheet.h);
      outW = Math.round(wIn * targetPpi); outH = Math.round(outW / asp);
    } else {
      const longPx = Math.min(1800, Math.max(sl.w, sl.h));
      if (asp >= 1) { outW = Math.round(longPx); outH = Math.round(longPx / asp); }
      else { outH = Math.round(longPx); outW = Math.round(longPx * asp); }
    }
  };
  sizeFor(aspect);
  let rect = warp(img, corners, outW, outH);
  let det = holeBlobs(rect, colors.backer, colors.paper);
  let sheetPpi = sheet ? outW / (aspect >= 1 ? Math.max(sheet.w, sheet.h) : Math.min(sheet.w, sheet.h)) : null;
  let singles = singleHoles(det.blobs, sheetPpi ? holeIn * sheetPpi : null);

  // Without a known sheet size the squared-up image can be a little stretched.
  // Round holes tell us by how much: fix the stretch and redo.
  if (!sheet && singles.length >= 2) {
    const s = median(singles.map((b) => Math.sqrt(b.syy / b.sxx)));
    if (Math.abs(s - 1) > 0.008 && Math.abs(s - 1) < 0.35) {
      aspect = aspect * s;
      sizeFor(aspect);
      rect = warp(img, corners, outW, outH);
      det = holeBlobs(rect, colors.backer, colors.paper);
      singles = singleHoles(det.blobs, null);
    }
  }

  // Scale
  const holePpi = singles.length ? median(singles.map((b) => b.eqDia)) / holeIn : null;
  let ppi = null, scaleSource = null;
  if (opts.forcePpi) { ppi = opts.forcePpi; scaleSource = "manual"; }
  else if (holePpi && (singles.length >= 3 || !sheetPpi)) { ppi = holePpi; scaleSource = "holes"; }
  else if (sheetPpi) { ppi = sheetPpi; scaleSource = "sheet"; }
  if (holePpi && sheetPpi && !opts.forcePpi) {
    const diff = Math.abs(holePpi - sheetPpi) / sheetPpi;
    if (diff > 0.06)
      warnings.push(`Hole size and sheet size disagree on the scale by ${(diff * 100).toFixed(0)}%. Check the caliber and the sheet size.`);
  }
  if (!ppi) {
    warnings.push("No clean single hole to set the scale from. Pick the sheet size or set the scale by hand.");
    return { ok: true, stage: "scale", rect, corners, colors, warnings, groups: [], ppi: null, scaleSource: null, holeIn, singles: 0 };
  }
  if (scaleSource === "holes" && singles.length < 3)
    warnings.push(`Scale is from ${singles.length} clean hole${singles.length === 1 ? "" : "s"}. Check it against a known size if you can.`);

  // Shots: one per clean hole, more where holes are torn together.
  const rPx = (holeIn * ppi) / 2;
  const singleArea = Math.PI * rPx * rPx;
  const maxBlob = singleArea * 40;
  const holes = det.blobs.filter((b) => b.area > singleArea * 0.3 && b.area < maxBlob);
  // Sort holes into groups. On sheets with several printed bullseyes (A-17,
  // A-32, dot sheets) each hole goes with the bullseye it is nearest, the way
  // an instructor scores by eye. Holes far from any bullseye, and sheets with
  // fewer than two bullseyes, fall back to grouping holes that sit close together.
  const bulls = findBulls(rect, colors, ppi, det.mask);
  const byRoot = new Map();
  const loose = [];
  if (bulls.length >= 2) {
    for (const b of holes) {
      let bi = -1, bd = Infinity;
      bulls.forEach((u, i) => { const d = Math.hypot(b.cx - u.x, b.cy - u.y); if (d < bd) { bd = d; bi = i; } });
      const reach = Math.max(bulls[bi].r * 1.6, bulls[bi].r + 1.0 * ppi);
      if (bd <= reach) { const key = "bull" + bi; if (!byRoot.has(key)) byRoot.set(key, []); byRoot.get(key).push(b); }
      else loose.push(b);
    }
  } else loose.push(...holes);
  // leftover holes: group those within 1.25" of each other (edge to edge)
  const gap = 1.25 * ppi;
  const parent = loose.map((_, i) => i);
  const find = (i) => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < loose.length; i++)
    for (let j = i + 1; j < loose.length; j++) {
      const a = loose[i], b = loose[j];
      const dx = Math.max(0, Math.max(a.minX, b.minX) - Math.min(a.maxX, b.maxX));
      const dy = Math.max(0, Math.max(a.minY, b.minY) - Math.min(a.maxY, b.maxY));
      if (Math.hypot(dx, dy) < gap) parent[find(i)] = find(j);
    }
  loose.forEach((b, i) => { const r = "loose" + find(i); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(b); });

  const groups = [];
  for (const [key, members] of byRoot.entries()) {
    // how many shots in each hole: at least one each, the rest go where the
    // torn area is biggest compared with the shots already given to it
    const k = members.map(() => 1);
    const est = members.map((b) => b.area / singleArea);
    let total = members.length;
    const want = Math.max(total, perGroup);
    // extra shots only go into holes that are clearly torn together (bigger than one hole)
    const room = want - total;
    for (let t = 0; t < room; t++) {
      let bi = -1, bv = -Infinity;
      // a group short of its shots: a hole that is too big, or stretched out of round, hides another shot
      members.forEach((b, i) => { const v = est[i] / k[i]; const torn = est[i] > 1.25 || (est[i] > 1.08 && b.ratio < 0.8); if (v > bv && torn && est[i] > k[i] * 0.45) { bv = v; bi = i; } });
      if (bi < 0) break;
      k[bi]++; total++;
    }
    const shots = [];
    members.forEach((b, i) => {
      if (k[i] === 1 && b.ratio > 0.7) shots.push({ x: b.cx, y: b.cy, auto: true });
      else for (const c of fitCircles(b, k[i], rPx, det.w)) shots.push({ x: c[0], y: c[1], auto: true });
    });
    const bull = key.startsWith("bull") ? bulls[+key.slice(4)] : null;
    groups.push({ shots, holes: members.length, likelyShots: total, bull: bull ? { x: bull.x, y: bull.y, r: bull.r } : null });
  }
  // reading order: top to bottom, left to right (rows within half an inch count as one row)
  const at = (g) => (g.bull ? [g.bull.x, g.bull.y] : [g.shots.reduce((t, p) => t + p.x, 0) / g.shots.length, g.shots.reduce((t, p) => t + p.y, 0) / g.shots.length]);
  groups.sort((a, b) => { const [ax, ay] = at(a), [bx, by] = at(b); return Math.abs(ay - by) > 0.5 * ppi ? ay - by : ax - bx; });
  for (const g of groups) if (g.shots.length !== perGroup && g.shots.length > 1)
    g.note = `Found ${g.shots.length} shots here, expected ${perGroup}. Check the markers.`;

  return {
    ok: true, stage: "done", rect, corners, colors, warnings, groups, ppi, scaleSource,
    holePpi, sheetPpi, holeIn, singles: singles.length, rPx, bulls: bulls.length,
  };
}

// Printed bullseyes: round dark marks (solid black centers or ring sets)
// between 0.3" and 4" across. Holes inside the black count as part of it, and
// rings that share a center are treated as one bullseye.
function findBulls(rect, colors, ppi, holeMask) {
  const { width: w, height: h, data } = rect;
  const yDark = colors.paper[0] * 0.5;
  const mask = new Uint8Array(w * h);
  for (let i = 0, q = 0; i < w * h; i++, q += 4) {
    const y = 0.299 * data[q] + 0.587 * data[q + 1] + 0.114 * data[q + 2];
    if (y < yDark) mask[i] = 2; // printed ink
    else if (holeMask[i]) mask[i] = 1; // a hole inside the print
  }
  const label = new Int32Array(w * h).fill(-1);
  const stack = new Int32Array(w * h);
  const cands = [];
  for (let i = 0; i < w * h; i++) {
    if (!mask[i] || label[i] !== -1) continue;
    let sp = 0, n = 0, ink = 0, sx = 0, sy = 0, minX = w, maxX = 0, minY = h, maxY = 0;
    stack[sp++] = i; label[i] = 1;
    while (sp) {
      const q = stack[--sp], x = q % w, y = (q / w) | 0;
      n++; sx += x; sy += y; if (mask[q] === 2) ink++;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      if (x > 0 && mask[q - 1] && label[q - 1] === -1) { label[q - 1] = 1; stack[sp++] = q - 1; }
      if (x < w - 1 && mask[q + 1] && label[q + 1] === -1) { label[q + 1] = 1; stack[sp++] = q + 1; }
      if (y > 0 && mask[q - w] && label[q - w] === -1) { label[q - w] = 1; stack[sp++] = q - w; }
      if (y < h - 1 && mask[q + w] && label[q + w] === -1) { label[q + w] = 1; stack[sp++] = q + w; }
    }
    const bw = maxX - minX + 1, bh = maxY - minY + 1, d = Math.max(bw, bh);
    if (d < 0.3 * ppi || d > 4 * ppi) continue;
    if (Math.abs(bw - bh) > 0.15 * d) continue; // round marks have a square outline
    const cx = sx / n + 0.5, cy = sy / n + 0.5;
    const bx = (minX + maxX + 1) / 2, by = (minY + maxY + 1) / 2;
    if (Math.hypot(cx - bx, cy - by) > 0.12 * d) continue; // the dark is spread evenly around its center
    if (n < 0.08 * d * d) continue; // more than a hairline
    if (ink < 0.6 * n) continue; // mostly printed ink, so a cluster of holes isn't mistaken for a bullseye
    cands.push({ x: bx, y: by, r: d / 2 });
  }
  // Bullseyes never sit inside one another, so anything inside a bigger one is
  // part of it: its inner rings, or a piece of black cut off by torn paper.
  cands.sort((a, b) => b.r - a.r);
  const bulls = [];
  for (const c of cands) if (!bulls.some((u) => Math.hypot(u.x - c.x, u.y - c.y) < u.r)) bulls.push(c);
  return bulls;
}

// Convert a group's markers (rectified pixels) to inches and measure.
export function measureGroup(shotsPx, ppi, holeIn) {
  return groupMetrics(shotsPx.map((s) => ({ x: s.x / ppi, y: s.y / ppi })), holeIn);
}
