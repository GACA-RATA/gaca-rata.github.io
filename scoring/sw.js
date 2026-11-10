// Keeps the app working with no signal once it has been opened once.
const VERSION = "rata-scoring-6";
const SHELL = ["./", "index.html", "styles.css", "config.js", "app.js", "store.js", "engine.js", "worker.js", "manifest.webmanifest", "icon.svg", "icon-192.png", "icon-512.png"];
const LIBS = [
  "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js",
  "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(SHELL.map((u) => new Request(u, { cache: "reload" })));
    await Promise.all(LIBS.map((u) => c.add(u).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== VERSION) await caches.delete(k);
    self.clients.claim();
  })());
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return; // syncing goes straight to the network
  const url = new URL(req.url);
  if (url.hostname.endsWith("google.com") || url.hostname.endsWith("googleusercontent.com")) return;
  // app files: use the network when there is signal so updates show up, fall back to the saved copy
  e.respondWith((async () => {
    const c = await caches.open(VERSION);
    try {
      // same-site files: always ask the site for the latest copy instead of a stale browser copy
      const fresh = await fetch(req, url.origin === location.origin ? { cache: "no-cache" } : undefined);
      if (fresh.ok && (url.origin === location.origin || url.hostname === "cdnjs.cloudflare.com")) c.put(req, fresh.clone());
      return fresh;
    } catch {
      const hit = await c.match(req, { ignoreSearch: true });
      if (hit) return hit;
      if (req.mode === "navigate") return c.match("index.html");
      throw new Error("offline");
    }
  })());
});
