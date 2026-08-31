/* Offline support for DOT.log.
   Bump CACHE_NAME whenever index.html changes so old cached copies get
   cleaned up — the fetch handler below already keeps things fresh in the
   background on its own, this is just a belt-and-braces cleanup trigger. */
const CACHE_NAME = "dotlog-v10";
const APP_SHELL = [
  "./",
  "./index.html",
  "./manifest.json",
  "./icon-192.png",
  "./icon-512.png",
  "./icon-512-maskable.png",
  "./apple-touch-icon.png",
  "./favicon-32.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  /* Deliberately NOT skipWaiting() here. This worker sits in "waiting"
     until the page's Update ready prompt is tapped, so a new version is
     never swapped in underneath someone half-way through logging a day.
     If the prompt is ignored, it activates on its own once the app is
     fully closed — the old close-and-reopen behaviour, still intact. */
});

/* the page asks for the swap when the user taps Reload */
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((names) =>
      Promise.all(names.filter((n) => n !== CACHE_NAME).map((n) => caches.delete(n)))
    )
  );
  self.clients.claim();
});

/* stale-while-revalidate: answer instantly from cache (so it works with
   zero network at all), and quietly refresh the cache in the background
   whenever there IS a connection, so the next launch has the latest copy */
self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    caches.open(CACHE_NAME).then(async (cache) => {
      const cached = await cache.match(event.request);
      const networkFetch = fetch(event.request)
        .then((response) => {
          if (response && response.status === 200) cache.put(event.request, response.clone());
          return response;
        })
        .catch(() => cached);
      return cached || networkFetch;
    })
  );
});
