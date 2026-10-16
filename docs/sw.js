const CACHE = "stx-dps-v18";
const ASSETS = [
  "./",
  "./index.html",
  "./app.js",
  "./app.js?v=18",
  "./jspdf.umd.min.js",
  "./stx-logo-v2.png",
  "./stx-logo-pdf-v2.jpg",
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
      Promise.all(keys.filter((key) => key !== CACHE && key !== "stx-preview").map((key) => caches.delete(key)))
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
  // Report previews live at ./preview/<file name>.pdf so the share sheet keeps the name.
  if (event.request.url.indexOf("/preview/") >= 0) {
    event.respondWith((async () => {
      const cache = await caches.open("stx-preview");
      const hit = await cache.match(event.request, { ignoreSearch: true });
      return hit || new Response("Preview expired. Go back to the app and tap Preview PDF again.", { status: 404, headers: { "Content-Type": "text/plain" } });
    })());
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
