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
     Text size

     Both apps set their text in fixed pixels, so there is no root size to
     turn up — changing one would do nothing. Zoom is the honest tool
     here: it scales the whole CSS pixel space, so every size in both
     apps grows together, including ones written years ago.

     It also shrinks the usable width in the same breath, which is what
     saves it: the layout simply reflows narrower instead of running off
     the side of the screen. Applied the moment this script runs rather
     than on load, so the page is not painted small and then jumped. */

  var SIZE_KEY = "cna.textScale";
  var SIZES = ["0.9", "1", "1.15", "1.3"];

  function readScale() {
    var v;
    try { v = localStorage.getItem(SIZE_KEY); } catch (e) {}
    return SIZES.indexOf(v) === -1 ? "1" : v;
  }

  function applyScale(value) {
    var el = document.documentElement;
    if (value === "1") el.style.removeProperty("zoom");
    else el.style.zoom = value;
  }

  function setScale(value) {
    try { localStorage.setItem(SIZE_KEY, value); } catch (e) {}
    applyScale(value);
  }

  applyScale(readScale());

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
     Home screen order

     Hold an icon down to start moving things, drag it where you want it,
     tap anywhere else to finish — the way a phone does it. The order is
     remembered on this device only.
     ------------------------------------------------------------------ */

  var ORDER_KEY = "cna.appOrder";

  /* Today's date, shown at the top of the home screen. Both apps are about
     which day you worked, so it is worth reading before anything is tapped.
     Redrawn when the app comes back to the foreground and once a minute, so
     a phone left open overnight is not still showing yesterday. */
  function initToday() {
    var dayEl = document.getElementById("cna-today-day");
    var dateEl = document.getElementById("cna-today-date");
    if (!dayEl || !dateEl) return;

    var shown = "";

    function paint() {
      var now = new Date();
      var stamp = now.toDateString();
      if (stamp === shown) return;
      shown = stamp;
      try {
        dayEl.textContent = now.toLocaleDateString(undefined, { weekday: "long" });
        dateEl.textContent = now.toLocaleDateString(undefined, {
          day: "numeric", month: "long", year: "numeric"
        });
      } catch (e) {
        dayEl.textContent = "";
        dateEl.textContent = now.toDateString();
      }
    }

    paint();
    setInterval(paint, 60000);
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) paint();
    });
  }

  function initHomeScreen() {
    var grid = document.getElementById("cna-app-grid");
    if (!grid) return null;

    var tiles = function () { return [].slice.call(grid.querySelectorAll(".cna-app")); };

    function saveOrder() {
      try {
        localStorage.setItem(ORDER_KEY, JSON.stringify(tiles().map(function (t) { return t.dataset.appId; })));
      } catch (e) {}
    }

    function applySavedOrder() {
      var saved;
      try { saved = JSON.parse(localStorage.getItem(ORDER_KEY) || "null"); } catch (e) { saved = null; }
      if (!saved || !saved.length) return;
      saved.forEach(function (id) {
        var tile = grid.querySelector('[data-app-id="' + id + '"]');
        if (tile) grid.appendChild(tile);
      });
      /* anything added since the order was saved falls in at the end,
         which is what a new app should do */
    }
    applySavedOrder();

    /* ---- moving mode ---- */

    var editing = false;
    var dragTile = null;
    var pressTimer = null;
    var startX = 0, startY = 0;
    var offsetX = 0, offsetY = 0;
    var moved = false;

    /* Once the icons are moving, every tap on one is deliberately ignored
       so a drag cannot open an app by accident. That leaves someone stuck
       unless there is an obvious way out, so moving mode always shows a
       Done button. Tapping anywhere off the icons works too. */
    var doneBtn = null;

    function showDone() {
      if (doneBtn) return;
      doneBtn = document.createElement("button");
      doneBtn.type = "button";
      doneBtn.className = "cna-done";
      doneBtn.textContent = "Done";
      doneBtn.addEventListener("click", function () { setEditing(false); });
      document.body.appendChild(doneBtn);
    }

    function hideDone() {
      if (!doneBtn) return;
      doneBtn.remove();
      doneBtn = null;
    }

    function setEditing(on) {
      editing = on;
      grid.classList.toggle("is-editing", on);
      document.body.classList.toggle("cna-editing", on);
      if (on) showDone();
      else { hideDone(); saveOrder(); }
    }

    function tileUnder(x, y) {
      return tiles().filter(function (t) {
        if (t === dragTile) return false;
        var r = t.getBoundingClientRect();
        return x >= r.left && x <= r.right && y >= r.top && y <= r.bottom;
      })[0];
    }

    /* The tile keeps its place in the grid and is only offset visually,
       so when it swaps position the other icons genuinely shift and you
       can see where it is going to land. */
    function rebase(e) {
      dragTile.style.transform = "";
      var r = dragTile.getBoundingClientRect();
      offsetX = e.clientX - r.left;
      offsetY = e.clientY - r.top;
    }

    function beginDrag(tile, e) {
      dragTile = tile;
      moved = false;
      tile.classList.add("is-dragging");
      rebase(e);
      moveDragTo(e);
    }

    function moveDragTo(e) {
      dragTile.style.transform = "";
      var r = dragTile.getBoundingClientRect();
      var dx = e.clientX - (r.left + offsetX);
      var dy = e.clientY - (r.top + offsetY);
      dragTile.style.transform = "translate(" + dx + "px," + dy + "px)";
    }

    function endDrag() {
      if (!dragTile) return;
      dragTile.classList.remove("is-dragging");
      dragTile.style.transform = "";
      dragTile = null;
      saveOrder();
    }

    /* A held link makes a phone offer its own menu — Open, Open in new tab.
       That menu appears over the app and cancels the hold, so the icons
       could never be rearranged on a phone. Refusing it here, together
       with the callout rules in the stylesheet, gives the gesture back.
       Right-click on a computer lands in the same place and is left alone
       unless the icons are actually being moved. */
    grid.addEventListener("contextmenu", function (e) {
      if (e.pointerType === "mouse" && !editing) return;
      e.preventDefault();
    });

    /* the browser's own picture-dragging would fight the reorder */
    [].forEach.call(grid.querySelectorAll(".cna-app"), function (t) {
      t.setAttribute("draggable", "false");
    });
    grid.addEventListener("dragstart", function (e) { e.preventDefault(); });

    grid.addEventListener("pointerdown", function (e) {
      var tile = e.target.closest(".cna-app");
      if (!tile) return;

      startX = e.clientX;
      startY = e.clientY;

      if (editing) {
        e.preventDefault();
        /* capture keeps the drag alive if the finger slides off the tile.
           If the browser refuses it, dragging still works through the
           grid's own listeners, so this must never stop the drag. */
        try { tile.setPointerCapture(e.pointerId); } catch (err) {}
        beginDrag(tile, e);
        return;
      }

      /* A long hold starts moving mode without blocking a normal tap. The
         wait has to be longer than an unhurried tap, or someone whose
         finger rests a moment ends up moving icons when they meant to
         open an app — which is exactly what happened at 450ms. */
      pressTimer = setTimeout(function () {
        pressTimer = null;
        setEditing(true);
        try { tile.setPointerCapture(e.pointerId); } catch (err) {}
        beginDrag(tile, e);
        /* a small tick so the hold is felt, not just seen. Some browsers
           refuse it outright, which must not interrupt the drag. */
        try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) {}
      }, 650);
    });

    grid.addEventListener("pointermove", function (e) {
      if (pressTimer && (Math.abs(e.clientX - startX) > 8 || Math.abs(e.clientY - startY) > 8)) {
        clearTimeout(pressTimer);
        pressTimer = null;
      }
      if (!dragTile) return;
      e.preventDefault();
      moved = true;
      moveDragTo(e);

      var over = tileUnder(e.clientX, e.clientY);
      if (over) {
        var list = tiles();
        var from = list.indexOf(dragTile);
        var to = list.indexOf(over);
        if (from < to) grid.insertBefore(dragTile, over.nextSibling);
        else grid.insertBefore(dragTile, over);
        /* it just moved slot, so re-measure before the next offset */
        rebase(e);
        moveDragTo(e);
      }
    });

    function release(e) {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
      if (dragTile) {
        /* a drag must not also count as opening the app */
        if (moved && e) { e.preventDefault(); }
        endDrag();
      }
    }
    grid.addEventListener("pointerup", release);
    grid.addEventListener("pointercancel", release);

    /* while moving, tapping an icon must not open it */
    grid.addEventListener("click", function (e) {
      if (!editing) return;
      e.preventDefault();
      e.stopPropagation();
    }, true);

    /* tap anywhere off the grid to finish */
    document.addEventListener("pointerdown", function (e) {
      if (!editing) return;
      if (e.target.closest("#cna-app-grid")) return;
      setEditing(false);
    });

    return { start: function () { setEditing(true); } };
  }

  var homeScreen = null;

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

    /* text size */
    var sizeSeg = document.getElementById("cna-size-picker");
    function paintSize() {
      var current = readScale();
      [].forEach.call(sizeSeg.querySelectorAll("button"), function (b) {
        var on = b.dataset.scale === current;
        b.classList.toggle("is-on", on);
        b.setAttribute("aria-pressed", String(on));
      });
    }
    [].forEach.call(sizeSeg.querySelectorAll("button"), function (b) {
      b.addEventListener("click", function () {
        setScale(b.dataset.scale);
        paintSize();
      });
    });
    paintSize();

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
            /* stored as version-bN; people are only shown the version */
            var haveShown = have ? String(have).split("-b")[0] : null;
            var wantTag = latest ? latest.version + "-b" + (latest.build || 0) : null;

            if (!latest) {
              offline = true;
              setRow(app.id, haveShown ? "Installed v" + haveShown + " · can't check right now" : "Can't check right now", null);
              return;
            }
            if (!have) {
              setRow(app.id, "Getting ready…", null);
              installApp(app, latest, true);
              return;
            }
            if (have !== wantTag) {
              var toShown = latest.version;
              setRow(app.id, haveShown === toShown
                ? "v" + haveShown + " · a fix is ready"
                : "v" + haveShown + " · update ready to v" + toShown, "Update");
            } else {
              setRow(app.id, "v" + haveShown + " · up to date", null);
            }
          });

          try { localStorage.setItem(LAST_CHECK_KEY, String(Date.now())); } catch (e) {}
          checkBtn.disabled = false;
          checkBtn.textContent = offline ? "Try again" : "Check for updates";
        });
    }

    function installApp(app, info, quiet) {
      setRow(app.id, quiet ? "Getting ready…" : "Updating…", null);
      return ask({ type: "INSTALL", id: app.id, version: info.version, build: info.build, files: info.files })
        .then(function (res) {
          if (res && res.ok) {
            setRow(app.id, "v" + String(res.version).split("-b")[0] + " · up to date", null);
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
        /* Phones clear caches on their own — iOS does it for an app left
           unopened for a week. Check on every visit that everything is
           still stored, and quietly put back whatever went missing. */
        ask({ type: "ENSURE_SHELL" });

        ask({ type: "STATUS" }).then(function (installed) {
          if (!installed) return;
          APPS.forEach(function (app) {
            if (installed[app.id]) return;
            fetchVersionFile(app.id).then(function (info) {
              if (info) ask({ type: "INSTALL", id: app.id, version: info.version, build: info.build, files: info.files });
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
    initToday();
    homeScreen = initHomeScreen();
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
