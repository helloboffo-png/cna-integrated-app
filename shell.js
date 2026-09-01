/* The container's own script. Loaded by the home screen and by each
   sub-app page.

   It does three jobs:
     1. registers the shared offline worker, and offers the reload prompt
        when a new container version is genuinely ready
     2. keeps one Appearance setting and writes it into each sub-app's own
        preference, in that app's own format — no sub-app is modified
     3. drives the Settings screen: one update line per sub-app, each with
        its own button

   Loaded from the home screen as "shell.js" and from a sub-app as
   "../shell.js", so the container root is worked out from this script's
   own address rather than assumed. */
(function () {
  "use strict";

  var self_src = (document.currentScript && document.currentScript.src) || "";
  var ROOT = self_src ? new URL("./", self_src).href : new URL("./", location.href).href;
  var at = function (p) { return new URL(p, ROOT).href; };

  var THEME_KEY = "cna.theme";
  var LAST_CHECK_KEY = "cna.lastUpdateCheck";
  var CHECK_GAP_MS = 10 * 60 * 1000;

  var reg = null;
  var lastCheck = 0;

  /* ------------------------------------------------------------------
     Appearance

     Each sub-app already stores its own light/dark choice, in its own
     shape. Rather than reach inside either app and change how it reads
     that, the container writes the value each app already expects. The
     apps then start up in the right mode having never been touched.
     ------------------------------------------------------------------ */

  function readTheme() {
    try { return localStorage.getItem(THEME_KEY) || "auto"; } catch (e) { return "auto"; }
  }

  function deviceIsDark() {
    return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
  }

  function applyThemeLocally(mode) {
    if (mode === "light" || mode === "dark") {
      document.documentElement.setAttribute("data-cna-theme", mode);
    } else {
      document.documentElement.removeAttribute("data-cna-theme");
    }
  }

  /* DOT.log keeps everything in one bundle and understands "auto". */
  function writeThemeToDotLog(mode) {
    try {
      var raw = localStorage.getItem("driveotlog.v1");
      if (!raw) return false;
      var db = JSON.parse(raw);
      if (!db || typeof db !== "object") return false;
      db.settings = db.settings || {};
      db.settings.theme = mode;
      localStorage.setItem("driveotlog.v1", JSON.stringify(db));
      return true;
    } catch (e) { return false; }
  }

  /* OT Builder stores only "light" or "dark", so "auto" is resolved to
     whatever the phone is set to at the moment the choice is made. */
  function writeThemeToOtBuilder(mode) {
    try {
      var value = mode === "auto" ? (deviceIsDark() ? "dark" : "light") : mode;
      localStorage.setItem("otFormBuilder.theme", value);
      return true;
    } catch (e) { return false; }
  }

  function setTheme(mode) {
    try { localStorage.setItem(THEME_KEY, mode); } catch (e) {}
    applyThemeLocally(mode);
    writeThemeToDotLog(mode);
    writeThemeToOtBuilder(mode);
  }

  applyThemeLocally(readTheme());

  /* ------------------------------------------------------------------
     Talking to the offline worker
     ------------------------------------------------------------------ */

  function ask(message) {
    return new Promise(function (resolve) {
      if (!navigator.serviceWorker || !navigator.serviceWorker.controller) { resolve(null); return; }
      var ch = new MessageChannel();
      var done = false;
      var timer = setTimeout(function () { if (!done) { done = true; resolve(null); } }, 20000);
      ch.port1.onmessage = function (e) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        resolve(e.data);
      };
      navigator.serviceWorker.controller.postMessage(message, [ch.port2]);
    });
  }

  function fetchVersionFile(id) {
    return fetch(at(id + "/version.json"), { cache: "no-store" })
      .then(function (r) { return r.ok ? r.json() : null; })
      .catch(function () { return null; });
  }

  /* ------------------------------------------------------------------
     The container's own update prompt

     Carried over from DOT.log unchanged in spirit: the incoming worker
     waits, the page offers one tap, and a half-typed entry is protected
     by a first tap that explains instead of acting.
     ------------------------------------------------------------------ */

  function hasUnsavedWork() {
    try {
      return typeof window.dotlogHasUnsaved === "function" && window.dotlogHasUnsaved();
    } catch (e) { return false; }
  }

  function showUpdateBar(worker) {
    if (document.getElementById("cna-update-bar")) return;

    var bar = document.createElement("div");
    bar.id = "cna-update-bar";
    bar.className = "cna-update-bar";

    var label = document.createElement("span");
    label.textContent = "Update ready";

    var btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = "Reload";

    var armed = false;
    btn.addEventListener("click", function () {
      if (hasUnsavedWork() && !armed) {
        armed = true;
        label.textContent = "You have an unsaved entry — reloading loses it";
        btn.textContent = "Reload anyway";
        return;
      }
      btn.disabled = true;
      btn.textContent = "Updating…";
      worker.postMessage({ type: "SKIP_WAITING" });
    });

    bar.appendChild(label);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  }

  /* If the prompt is ignored for long enough, take the update anyway on a
     later launch — otherwise a phone that is never fully closed and never
     tapped sits on one version forever. Straight from DOT.log. */
  var STALL_KEY = "cna.updateSeen";
  var STALL_MS = 7 * 24 * 60 * 60 * 1000;

  function noteWaiting(worker) {
    var since = 0;
    try { since = parseInt(localStorage.getItem(STALL_KEY), 10) || 0; } catch (e) {}
    if (!since) {
      try { localStorage.setItem(STALL_KEY, String(Date.now())); } catch (e) {}
      return;
    }
    if (Date.now() - since > STALL_MS) {
      try { localStorage.removeItem(STALL_KEY); } catch (e) {}
      worker.postMessage({ type: "SKIP_WAITING" });
    }
  }

  function watchForUpdates(r) {
    if (r.waiting && navigator.serviceWorker.controller) {
      noteWaiting(r.waiting);
      showUpdateBar(r.waiting);
    }
    r.addEventListener("updatefound", function () {
      var incoming = r.installing;
      if (!incoming) return;
      incoming.addEventListener("statechange", function () {
        if (incoming.state === "installed" && navigator.serviceWorker.controller) showUpdateBar(incoming);
      });
    });
  }

  var reloading = false;
  if (navigator.serviceWorker) {
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloading) return;
      reloading = true;
      location.reload();
    });
  }

  /* ------------------------------------------------------------------
     Settings screen — only present on the home screen
     ------------------------------------------------------------------ */

  var APPS = [
    { id: "dot", name: "DOT.log" },
    { id: "ot", name: "OT Builder" }
  ];

  function initSettings() {
    var panel = document.getElementById("cna-settings");
    if (!panel) return;

    var home = document.getElementById("cna-home");
    var openBtn = document.getElementById("cna-settings-open");
    var closeBtn = document.getElementById("cna-settings-close");

    function show(settings) {
      panel.hidden = !settings;
      home.hidden = !!settings;
      window.scrollTo(0, 0);
      if (settings) refreshUpdates();
    }
    openBtn.addEventListener("click", function () { show(true); });
    closeBtn.addEventListener("click", function () { show(false); });

    /* appearance */
    var seg = document.getElementById("cna-theme-picker");
    function paintSeg() {
      var current = readTheme();
      [].forEach.call(seg.querySelectorAll("button"), function (b) {
        var on = b.dataset.theme === current;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    [].forEach.call(seg.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        setTheme(b.dataset.theme);
        paintSeg();
      });
    });
    paintSeg();

    /* updates */
    var list = document.getElementById("cna-update-list");
    var checkBtn = document.getElementById("cna-check-updates");

    function row(app) {
      var el = document.createElement("div");
      el.className = "cna-update-row";
      el.dataset.app = app.id;
      el.innerHTML =
        '<div class="cna-update-name">' + app.name +
        '<span class="cna-update-state">Checking…</span></div>' +
        '<button class="cna-update-btn" type="button" hidden>Update</button>';
      return el;
    }

    list.textContent = "";
    APPS.forEach(function (a) { list.appendChild(row(a)); });

    function setRow(id, state, buttonText) {
      var el = list.querySelector('[data-app="' + id + '"]');
      if (!el) return;
      el.querySelector(".cna-update-state").textContent = state;
      var btn = el.querySelector(".cna-update-btn");
      btn.hidden = !buttonText;
      if (buttonText) btn.textContent = buttonText;
    }

    function refreshUpdates() {
      checkBtn.disabled = true;
      checkBtn.textContent = "Checking…";

      Promise.all([ask({ type: "STATUS" })].concat(APPS.map(function (a) { return fetchVersionFile(a.id); })))
        .then(function (results) {
          var installed = results[0] || {};
          var offline = false;

          APPS.forEach(function (app, i) {
            var latest = results[i + 1];
            var have = installed[app.id];

            if (!latest) {
              offline = true;
              setRow(app.id, have ? "Installed v" + have + " · can't check right now" : "Can't check right now", null);
              return;
            }
            if (!have) {
              setRow(app.id, "Getting ready…", null);
              installApp(app, latest, true);
              return;
            }
            if (have !== latest.version) {
              setRow(app.id, "v" + have + " · update ready to v" + latest.version, "Update");
            } else {
              setRow(app.id, "v" + have + " · up to date", null);
            }
          });

          try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch (e) {}
          checkBtn.disabled = false;
          checkBtn.textContent = offline ? "Try again" : "Check for updates";
        });
    }

    function installApp(app, info, quiet) {
      setRow(app.id, quiet ? "Getting ready…" : "Updating…", null);
      return ask({ type: "INSTALL", id: app.id, version: info.version, files: info.files })
        .then(function (res) {
          if (res && res.ok) {
            setRow(app.id, "v" + res.version + " · up to date", null);
          } else {
            setRow(app.id, (res && res.error) ? "Update failed — " + res.error : "Update failed — check your connection", "Try again");
          }
        });
    }

    checkBtn.addEventListener("click", function () { refreshUpdates(); });

    list.addEventListener("click", function (e) {
      var btn = e.target.closest(".cna-update-btn");
      if (!btn) return;
      var id = btn.closest("[data-app]").dataset.app;
      var app = APPS.filter(function (a) { return a.id === id; })[0];
      btn.hidden = true;
      fetchVersionFile(id).then(function (info) {
        if (!info) { setRow(id, "Can't reach the update right now", "Try again"); return; }
        installApp(app, info, false);
      });
    });

    /* First run with no Settings visit yet: get both apps stored for
       offline use quietly in the background. */
    if (navigator.serviceWorker) {
      navigator.serviceWorker.ready.then(function () {
        ask({ type: "STATUS" }).then(function (installed) {
          if (!installed) return;
          APPS.forEach(function (app) {
            if (installed[app.id]) return;
            fetchVersionFile(app.id).then(function (info) {
              if (info) ask({ type: "INSTALL", id: app.id, version: info.version, files: info.files });
            });
          });
        });
      });
    }
  }

  /* ------------------------------------------------------------------
     Start up
     ------------------------------------------------------------------ */

  window.addEventListener("load", function () {
    initSettings();

    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register(at("sw.js"), { scope: ROOT })
      .then(function (r) {
        reg = r;
        lastCheck = Date.now();
        watchForUpdates(r);
        try {
          if (!r.waiting) localStorage.removeItem(STALL_KEY);
        } catch (e) {}
      })
      .catch(function () {});
  });

  /* A home-screen app can stay open for days without ever reloading, so
     checking when it comes back to the foreground is the only thing that
     will notice a new release on a phone that is never fully closed. */
  document.addEventListener("visibilitychange", function () {
    if (document.hidden || !reg) return;
    if (Date.now() - lastCheck < CHECK_GAP_MS) return;
    lastCheck = Date.now();
    reg.update().catch(function () {});
  });
})();
