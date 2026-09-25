const CACHE = "stx-dps-v9";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./app.js?v=9",
  "./jspdf.umd.min.js",
  "./stx-logo.png",
  "./stx-logo-pdf.jpg",
  "./icon-180.png",
  "./icon-192.png",
  "./icon-512.png",
  "./manifest.webmanifest",
  "./us-places.json",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  let host = "";
  try { host = new URL(event.request.url).hostname; } catch (e) { host = ""; }
  if (host === "api.weather.gov") {
    event.respondWith(fetch(event.request));
    return;
  }
  event.respondWith((async () => {
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      return await fetch(event.request);
    } catch (err) {
      if (event.request.mode === "navigate") {
        return (await caches.match("./index.html")) || (await caches.match("./"));
      }
      throw err;
    }
  })());
});
