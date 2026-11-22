// Service worker: makes the app installable and lets the screens open quickly.
// Financial data is never cached here; it always comes live from the server.
const CACHE = "lsa-shell-v2";
const SHELL = [
  "index.html", "dashboard.html", "believers.html", "funds.html",
  "transactions.html", "adjustments.html", "reports.html",
  "posting-rules.html", "settings.html", "reset.html",
  "style.css", "app.js", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Same-site screens and styles: try the network first so updates show at once;
// fall back to the saved copy only when offline. Everything else passes through.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  e.respondWith(
    // "no-cache" asks the server whether the file changed every time, so a new
    // release shows up at once instead of after the browser's own cache expires.
    fetch(e.request, { cache: "no-cache" })
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy));
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
