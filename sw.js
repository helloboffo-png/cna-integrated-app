/* Offline support for the CNA Integrated App.

   The point of this file is that each sub-app gets its OWN cache, named
   after its own version:

       cna-shell-v1.0.0
       cna-dot-v2.6.0
       cna-ot-v1.4.0

   Refreshing one of them touches only that one cache. DOT.log's stored
   copy cannot be disturbed by an OT Builder release, and the other way
   round — which is the whole reason the apps were kept apart.

   Sub-app caches are filled ONLY when the app asks for it (first run, or
   someone pressing Update in Settings). Nothing re-downloads quietly in
   the background, so a sub-app changes when a person decides it changes
   and at no other time.

   Deliberately NO skipWaiting() on install: a new worker waits until the
   page asks for the swap, so a new version is never dropped in on top of
   someone half-way through logging a day. That rule came from DOT.log and
   it still holds here. */

const SHELL_VERSION = "1.12.0";
const SHELL_CACHE = "cna-shell-v" + SHELL_VERSION;

/* Everything is resolved against the worker's own scope, so the app works
   the same at a domain root or in a subfolder like /cna-integrated-app/. */
const ROOT = new URL("./", self.registration.scope);
const at = (path) => new URL(path, ROOT).href;

const SHELL_ASSETS = [
  "./",
  "index.html",
  "shell.css",
  "shell.js",
  "manifest.json",
  "icon-192.png",
  "icon-512.png",
  "icon-512-maskable.png",
  /* stored too, so the apps keep their own lettering with no signal */
  "fonts/inter-tight-latin.woff2",
  "fonts/inter-tight-latin-ext.woff2"
].map(at);

const MODULE_PREFIXES = { dot: at("dot/"), ot: at("ot/") };

/* ---------------------------------------------------------------- */

/* Phones throw caches away. iOS in particular clears them for an app that
   has not been opened in a week or so, and a browser under storage
   pressure will do the same. The install event only ever runs once per
   version of this file, so if the container's cache disappears after that
   it would never come back and the app would simply stop working with no
   signal. So this is written to be safe to run at any time, and it is
   re-run on activation and whenever the page asks. */
async function ensureShellCached(force) {
  const cache = await caches.open(SHELL_CACHE);
  if (!force) {
    const have = await cache.keys();
    if (have.length >= SHELL_ASSETS.length) return false;
  }

  /* Fetched one by one with the browser's own cache bypassed, rather than
     through cache.addAll. addAll is happy to take a copy the browser is
     still holding — and this site is served with a ten minute freshness
     window — so a release could be stored under its new version number
     while actually containing the previous file. That is precisely what
     happened once: the container reported the new version and served the
     old script. The sub-app installer below always did it this way; this
     now matches it. */
  const fetched = await Promise.all(
    SHELL_ASSETS.map(async (url) => {
      const res = await fetch(url, { cache: "no-store" });
      if (!res || !res.ok) throw new Error("Could not download " + url);
      return [url, res];
    })
  );
  await Promise.all(fetched.map(([url, res]) => cache.put(url, res)));
  return true;
}

/* Installing and activating both take a fresh copy of every container
   file rather than keeping whatever is already stored. Without that, a
   release that changed only the home screen or the stylesheet would sit
   behind the old stored copy, and people would still be looking at the
   previous version. Bumping SHELL_VERSION below is what triggers it. */
self.addEventListener("install", (event) => {
  event.waitUntil(ensureShellCached(true));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    await ensureShellCached(true);
    /* Clear out old copies of the container only. A sub-app's cache is
       never swept here — it belongs to that sub-app's own version, and
       only an Update for that sub-app may replace it. */
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith("cna-shell-") && n !== SHELL_CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

/* which sub-app, if any, does this request belong to */
function moduleFor(url) {
  for (const [id, prefix] of Object.entries(MODULE_PREFIXES)) {
    if (url.startsWith(prefix)) return id;
  }
  return null;
}

async function cacheNameFor(id) {
  const names = await caches.keys();
  return names.find((n) => n.startsWith("cna-" + id + "-v")) || null;
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (!url.href.startsWith(ROOT.href)) return;

  /* A version file must always come off the network when there is one,
     otherwise the app could never notice that an update exists. */
  if (url.pathname.endsWith("/version.json")) {
    event.respondWith(fetch(req, { cache: "no-store" }).catch(() => caches.match(req)));
    return;
  }

  const id = moduleFor(url.href);

  if (id) {
    /* Sub-app: answer from that app's own stored copy, so it opens with
       no signal and stays on the exact version the user has installed.
       Anything not stored falls through to the network unchanged. */
    event.respondWith((async () => {
      const name = await cacheNameFor(id);
      if (name) {
        const hit = await caches.open(name).then((c) => c.match(req));
        if (hit) return hit;
      }
      return fetch(req);
    })());
    return;
  }

  /* Container: answer instantly from cache, refresh quietly behind it. */
  event.respondWith((async () => {
    const cache = await caches.open(SHELL_CACHE);
    const hit = await cache.match(req);
    const net = fetch(req)
      .then((res) => {
        if (res && res.status === 200) cache.put(req, res.clone());
        return res;
      })
      .catch(() => hit);
    return hit || net;
  })());
});

/* ---------------------------------------------------------------- */

/* A sub-app's stored copy is keyed on its version AND a build number.
   The version is the app author's own and is what people are shown; the
   build is bumped whenever the container edits anything inside that
   folder — the top bar, the shared stylesheet — so such a change still
   reaches phones. Without it the file changes on the server and nobody
   ever receives it, which is exactly what happened once. */
function moduleTag(version, build) {
  return version + "-b" + (build || 0);
}

async function installModule({ id, version, build, files }) {
  if (!MODULE_PREFIXES[id]) throw new Error("Unknown app: " + id);

  const prefix = MODULE_PREFIXES[id];
  const urls = ["./", ...files].map((f) => new URL(f, prefix).href);
  const target = "cna-" + id + "-v" + moduleTag(version, build);

  /* Fetch everything first and only keep it if the whole set arrives.
     A half-downloaded app is worse than the old one still working. */
  const cache = await caches.open(target);
  const responses = await Promise.all(
    urls.map(async (u) => {
      const res = await fetch(u, { cache: "no-store" });
      if (!res || !res.ok) throw new Error("Could not download " + u + " (" + (res && res.status) + ")");
      return [u, res];
    })
  );
  await Promise.all(responses.map(([u, res]) => cache.put(u, res)));

  /* Only now retire this app's previous copy. Other apps untouched. */
  const names = await caches.keys();
  await Promise.all(
    names
      .filter((n) => n.startsWith("cna-" + id + "-v") && n !== target)
      .map((n) => caches.delete(n))
  );

  return moduleTag(version, build);
}

async function status() {
  const names = await caches.keys();
  const out = {};
  for (const id of Object.keys(MODULE_PREFIXES)) {
    const hit = names.find((n) => n.startsWith("cna-" + id + "-v"));
    out[id] = hit ? hit.slice(("cna-" + id + "-v").length) : null;
  }
  out.shell = SHELL_VERSION;
  return out;
}

self.addEventListener("message", (event) => {
  const msg = event.data || {};
  const reply = (payload) => {
    const port = event.ports && event.ports[0];
    if (port) port.postMessage(payload);
  };

  if (msg.type === "SKIP_WAITING") { self.skipWaiting(); return; }

  if (msg.type === "STATUS") {
    event.waitUntil(status().then(reply, (e) => reply({ error: String(e) })));
    return;
  }

  /* asked on every page load, so a cache the phone threw away is rebuilt
     the next time the app is opened with a connection */
  if (msg.type === "ENSURE_SHELL") {
    event.waitUntil(
      ensureShellCached()
        .then((repaired) => reply({ ok: true, repaired: repaired }))
        .catch((e) => reply({ ok: false, error: String(e.message || e) }))
    );
    return;
  }

  if (msg.type === "INSTALL") {
    event.waitUntil(
      installModule(msg)
        .then((v) => reply({ ok: true, id: msg.id, version: v }))
        .catch((e) => reply({ ok: false, id: msg.id, error: String(e.message || e) }))
    );
  }
});
