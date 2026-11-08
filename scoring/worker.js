import { analyze } from "./engine.js";

self.onmessage = (e) => {
  const { img, opts } = e.data;
  try {
    const r = analyze(img, opts);
    const transfer = r.rect ? [r.rect.data.buffer] : [];
    self.postMessage({ ok: true, result: r }, transfer);
  } catch (err) {
    self.postMessage({ ok: false, error: String(err && err.stack || err) });
  }
};
