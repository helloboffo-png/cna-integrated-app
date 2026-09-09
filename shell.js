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

  /* DOT.log and OT Tracker each keep everything in one bundle and both
     understand "auto", so the same shape works for either store. */
  function writeThemeToBundle(key, mode) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return false;
      var db = JSON.parse(raw);
      if (!db || typeof db !== "object") return false;
      db.settings = db.settings || {};
      db.settings.theme = mode;
      localStorage.setItem(key, JSON.stringify(db));
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
    writeThemeToBundle("driveotlog.v1", mode);
    writeThemeToBundle("otlog.v1", mode);
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

  /* Any sub-app may expose window.cnaHasUnsaved to protect a half-typed
     entry from a reload. DOT.log named its own hook before there was a
     second app to share it, so that name is still honoured. */
  /* Set once Settings has drawn the container's own update line, so a
     release that turns up while that screen is open reaches it. */
  var repaintShellRow = null;
  var repaintBackup = null;
  var openSettings = null;

  function hasUnsavedWork() {
    try {
      var fn = window.cnaHasUnsaved || window.dotlogHasUnsaved;
      return typeof fn === "function" && !!fn();
    } catch (e) { return false; }
  }

  function showUpdateBar(worker) {
    /* Settings may be open with the container's line already drawn as
       up to date, so tell it a new one has landed. */
    if (repaintShellRow) { try { repaintShellRow(); } catch (e) {} }
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

  /* ------------------------------------------------------------------
     The line of figures under the date

     The home screen never reads a sub-app's storage. Each app leaves its
     own small summary under "cna.card.<id>" and this only arranges
     whatever it finds — so an app can be rebuilt, or decide to say
     something different, without a line of this changing. An app that
     has never been opened has left nothing, and simply contributes
     nothing rather than breaking the row.

     Everything read here was written by another app, so it is treated as
     untrusted: values become text through textContent, and the only link
     that can be built is a plain #screen inside that app's own folder.
     ------------------------------------------------------------------ */

  function readCards() {
    var out = [];
    APPS.forEach(function (app) {
      var card;
      try { card = JSON.parse(localStorage.getItem("cna.card." + app.id) || "null"); }
      catch (e) { return; }
      if (!card || !Array.isArray(card.items)) return;
      card.items.forEach(function (item) {
        if (!item || item.value === undefined || item.value === null) return;
        /* only a bare #screen name is accepted, so nothing an app writes
           can turn into a link off to somewhere else */
        var go = typeof item.go === "string" && /^#[a-z-]{1,20}$/.test(item.go)
          ? app.id + "/" + item.go
          : null;
        out.push({
          value: String(item.value).slice(0, 12),
          label: String(item.label || "").slice(0, 22),
          alert: !!item.alert,
          weight: typeof item.weight === "number" && isFinite(item.weight) ? item.weight : 0,
          go: go
        });
      });
    });
    /* ordered by the weight each app gave its figure, never by the value,
       so a figure never moves as its number changes */
    out.sort(function (a, b) { return b.weight - a.weight; });
    return out;
  }

  function initStrip() {
    var box = document.getElementById("cna-strip");
    if (!box) return;

    function paint() {
      var figures = readCards();
      box.textContent = "";
      if (!figures.length) return;

      /* three at full size, the rest smaller underneath */
      [figures.slice(0, 3), figures.slice(3)].forEach(function (group) {
        if (!group.length) return;
        var row = document.createElement("div");
        row.className = "cna-strip-row";
        group.forEach(function (f) {
          var cell = document.createElement(f.go ? "a" : "div");
          cell.className = "cna-fig" + (f.alert ? " cna-fig-hot" : "");
          if (f.go) cell.setAttribute("href", f.go);

          var n = document.createElement("span");
          n.className = "cna-fig-n";
          n.textContent = f.value;

          var l = document.createElement("span");
          l.className = "cna-fig-l";
          l.textContent = f.label;

          cell.appendChild(n);
          cell.appendChild(l);
          row.appendChild(cell);
        });
        box.appendChild(row);
      });
    }

    paint();
    /* coming back from an app is often a back gesture rather than a fresh
       load, so repaint whenever this page is looked at again */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) paint();
    });
    window.addEventListener("pageshow", paint);
  }

  /* ------------------------------------------------------------------
     What still needs doing

     The figures say what the numbers are. This says what the job is —
     and tapping one lands on the screen where it gets done.

     Same bargain as everything else here: the home screen never looks
     inside an app. Each app writes its own list of jobs under "todo" in
     its own card, in its own words, and this only arranges what it
     finds. An app with nothing outstanding writes nothing and this
     takes up no height at all, which is the point: a clear day should
     look clear.
     ------------------------------------------------------------------ */

  var TODO_SHOWN = 3;

  function readTodos() {
    var out = [];
    APPS.forEach(function (app) {
      var card;
      try { card = JSON.parse(localStorage.getItem("cna.card." + app.id) || "null"); }
      catch (e) { return; }
      if (!card || !Array.isArray(card.todo)) return;
      /* no app gets to fill the home screen on its own */
      card.todo.slice(0, 3).forEach(function (t) {
        if (!t || typeof t.text !== "string") return;
        var text = t.text.replace(/\s+/g, " ").trim();
        if (!text) return;
        out.push({
          text: text.slice(0, 60),
          settings: false,
          weight: typeof t.weight === "number" && isFinite(t.weight) ? t.weight : 0,
          /* only a bare #screen name is accepted, so nothing an app
             writes can turn into a link off to somewhere else */
          go: typeof t.go === "string" && /^#[a-z-]{1,20}$/.test(t.go)
            ? app.id + "/" + t.go
            : null
        });
      });
    });
    /* Backing up is this page's own job now, not any app's, so it is
       raised here — once, for the worst of them — from the dates the
       apps publish in their cards. Four apps nagging separately about
       the same one press was the thing this replaced. */
    var withData = backupAges().filter(function (a) { return a.hasData; });
    if (withData.length) {
      var never = withData.filter(function (a) { return !a.at; });
      var oldest = withData.slice().sort(function (a, b) {
        return (a.at || 0) - (b.at || 0);
      })[0];
      var d = ageDays(oldest.at);
      if (never.length || d >= 30) {
        out.push({
          text: never.length === withData.length ? "Back up \u2014 never done"
              : never.length ? "Back up \u2014 " + never.length + " never done"
              : "Back up \u2014 oldest is " + d + " days ago",
          /* Above everything when nothing has ever been backed up: an
             unclaimed receipt is money waiting, but no backup at all is
             the whole lot one dropped phone from gone. A merely stale one
             sits above housekeeping and below money. */
          weight: never.length ? 25 : 12,
          go: null,
          settings: true
        });
      }
    }

    /* by the weight each app gave the job, so the order is the app's
       judgement of what matters rather than whichever app was opened
       last */
    out.sort(function (a, b) { return b.weight - a.weight; });
    return out;
  }

  function initTodos() {
    var box = document.getElementById("cna-todo");
    if (!box) return;

    function paint() {
      var jobs = readTodos();
      box.textContent = "";
      if (!jobs.length) return;

      var head = document.createElement("div");
      head.className = "cna-todo-head";
      /* The count rather than a "+3 more" line underneath: it says the
         same thing, and a row of the app icons is worth more than a row
         that cannot be tapped. */
      head.textContent = jobs.length > TODO_SHOWN
        ? "Needs doing \u00b7 " + jobs.length
        : "Needs doing";
      box.appendChild(head);

      var list = document.createElement("div");
      list.className = "cna-todo-list";

      jobs.slice(0, TODO_SHOWN).forEach(function (j) {
        /* an app's job is a link into that app; this page's own job is a
           button, because Settings is not a page you can link to */
        var row = document.createElement(j.settings ? "button" : (j.go ? "a" : "div"));
        row.className = "cna-todo-row";
        if (j.settings) {
          row.type = "button";
          row.addEventListener("click", function () { if (openSettings) openSettings(); });
        } else if (j.go) {
          row.setAttribute("href", j.go);
        }

        var t = document.createElement("span");
        t.className = "cna-todo-text";
        t.textContent = j.text;
        row.appendChild(t);

        if (j.go || j.settings) {
          var go = document.createElement("span");
          go.className = "cna-todo-go";
          go.setAttribute("aria-hidden", "true");
          go.textContent = "›";
          row.appendChild(go);
        }
        list.appendChild(row);
      });

      box.appendChild(list);
    }

    paint();
    /* coming back from an app is often a back gesture rather than a
       fresh load, so repaint whenever this page is looked at again */
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) paint();
    });
    window.addEventListener("pageshow", paint);
  }

  /* ------------------------------------------------------------------
     The week under the figures

     Same bargain as the figures: the home screen never reads a sub-app's
     storage. Each app says which days it had something on, what to call
     it and what colour it is, under "marks" in its own card. This only
     draws what it finds, so an app can change its mind about any of that
     without a line of this changing, and an app that has never been
     opened simply contributes no colour.

     A week rather than a month by choice: a month grid is tall enough to
     push the app icons off the bottom of the screen, and the icons are
     the reason people open this page. Tapping the heading opens the
     month for the times that is actually wanted.
     ------------------------------------------------------------------ */

  /* Checked in UTC against UTC. Building a local Date and reading it back
     through toISOString compares local midnight with a UTC day, which is a
     different date everywhere east of Greenwich — here in +08 that would
     reject every real date. */
  function realDate(v) {
    if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return false;
    var b = v.split("-"), y = +b[0], mo = +b[1], da = +b[2];
    var d = new Date(Date.UTC(y, mo - 1, da));
    return d.getUTCFullYear() === y && d.getUTCMonth() + 1 === mo && d.getUTCDate() === da;
  }

  function readMarks() {
    var out = [];
    APPS.forEach(function (app) {
      var card;
      try { card = JSON.parse(localStorage.getItem("cna.card." + app.id) || "null"); }
      catch (e) { return; }
      if (!card || !Array.isArray(card.marks)) return;
      card.marks.forEach(function (m, mi) {
        if (!m) return;
        /* An app names its own marks. The name is only ever used as an id —
           in the tick list and in the calendar file — so anything that is
           not a plain word is dropped rather than trusted. */
        var markKey = String(m.key || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 20) || ("m" + mi);
        var markGo = m.go;
        /* a mark carries single days, a run of days, or both */
        var spans = [];
        if (Array.isArray(m.ranges)) {
          m.ranges.forEach(function (r) {
            if (!r || !realDate(r.from) || !realDate(r.to)) return;
            if (r.to < r.from) return;                 /* backwards, ignore */
            spans.push({ from: r.from, to: r.to, detail: String(r.detail || "").slice(0, 40) });
          });
        }
        if (!m.days || typeof m.days !== "object") {
          if (!spans.length) return;
          m = { label: m.label, colour: m.colour, days: {} };
        }
        /* a colour is the one thing an app hands over that gets used as
           markup, so only a plain six-digit hex is accepted */
        if (!/^#[0-9a-fA-F]{6}$/.test(String(m.colour || ""))) return;
        var days = {};
        Object.keys(m.days).forEach(function (iso) {
          /* the shape alone is not enough — "2026-13-99" passes a pattern
             check and then quietly sits in the legend matching no day of
             any month, so the date has to be a real one */
          if (!realDate(iso)) return;
          /* Checked in UTC against UTC. Building a local Date and reading
             it back through toISOString compares local midnight with a UTC
             day, which is a different date everywhere east of Greenwich —
             here in +08 that rejected every real date and left the
             calendar blank. */
          days[iso] = String(m.days[iso] || "").slice(0, 40);
        });
        if (!Object.keys(days).length && !spans.length) return;
        out.push({
          app: app.id,
          key: markKey,
          label: String(m.label || "").slice(0, 20),
          colour: String(m.colour),
          /* Where a tap on this activity should land. Same rule as the
             figures: only a bare #screen inside that app's own folder is
             accepted, so nothing an app writes can become a link off to
             somewhere else. With none given, the app's front page. */
          go: typeof markGo === "string" && /^#[a-z-]{1,20}$/.test(markGo)
            ? app.id + "/" + markGo
            : app.id + "/",
          days: days,
          spans: spans
        });
      });
    });
    return out;   /* app order, so a colour never moves between days */
  }

  function initCalendar() {
    var box = document.getElementById("cna-cal");
    if (!box) return;

    var DOW = ["M", "T", "W", "T", "F", "S", "S"];
    var MONTHS = ["January", "February", "March", "April", "May", "June",
                  "July", "August", "September", "October", "November", "December"];

    var expanded = false;
    var cursor = null;       /* Date, any day inside the period being shown */
    var picked = null;       /* iso of the day tapped open */
    var MONTHS_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun",
                        "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

    function pad2(n) { return (n < 10 ? "0" : "") + n; }
    function iso(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
    function startOfWeek(d) {
      var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));   /* weeks start Monday */
      return x;
    }

    function paint() {
      var marks = readMarks();
      box.textContent = "";

      /* The week is drawn whether or not anything has been logged. It is
         a calendar first and a record second: on a quiet week it still
         answers what day it is and where the weekend falls, and the page
         does not change height as days get logged. */
      var today = new Date();
      var todayIso = iso(today);
      if (!cursor) cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());

      /* is the period on screen the one today falls in? */
      var weekStart = startOfWeek(cursor);
      var weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
      var onNow = expanded
        ? (cursor.getFullYear() === today.getFullYear() && cursor.getMonth() === today.getMonth())
        : (todayIso >= iso(weekStart) && todayIso <= iso(weekEnd));

      function step(n) {
        cursor = expanded
          ? new Date(cursor.getFullYear(), cursor.getMonth() + n, 1)
          : new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + n * 7);
        picked = null;
        paint();
      }

      /* ---- heading ---- */
      var head = document.createElement("button");
      head.type = "button";
      head.className = "cna-cal-head";
      var title = document.createElement("span");
      title.className = "cna-cal-title";
      if (expanded) {
        title.textContent = MONTHS[cursor.getMonth()] + " " + cursor.getFullYear();
      } else if (onNow) {
        title.textContent = "This week";
      } else {
        /* a week that has been swiped away from has to say which one it is */
        title.textContent = weekStart.getDate() + " " + MONTHS_SHORT[weekStart.getMonth()] +
          " – " + weekEnd.getDate() + " " + MONTHS_SHORT[weekEnd.getMonth()];
      }
      var hint = document.createElement("span");
      hint.className = "cna-cal-hint";
      hint.textContent = expanded ? "show the week" : "show the month";
      head.appendChild(title);
      head.appendChild(hint);
      head.addEventListener("click", function () {
        expanded = !expanded;
        picked = null;
        paint();     /* stay on whatever period was being looked at */
      });
      box.appendChild(head);

      /* ---- day-of-week row ---- */
      var dow = document.createElement("div");
      dow.className = "cna-cal-dow";
      DOW.forEach(function (d) {
        var s = document.createElement("span");
        s.textContent = d;
        dow.appendChild(s);
      });
      box.appendChild(dow);

      /* ---- the cells ---- */
      var grid = document.createElement("div");
      grid.className = "cna-cal-grid" + (expanded ? "" : " cna-cal-week");

      var cells = [];
      if (expanded) {
        var first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
        var lead = (first.getDay() + 6) % 7;
        for (var i = 0; i < lead; i++) cells.push(null);
        var last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate();
        for (var d = 1; d <= last; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d));
        while (cells.length % 7) cells.push(null);
      } else {
        for (var k = 0; k < 7; k++) {
          cells.push(new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + k));
        }
      }

      /* Drawn a week at a time so a run of days can be a single line
         underneath them. A trip that carries on past Sunday is cut flat at
         that edge and picked up rounded on the next row, the way a
         calendar shows an event continuing. */
      function drawCell(date) {
        if (!date) {
          var blank = document.createElement("div");
          blank.className = "cna-cal-cell cna-cal-blank";
          return blank;
        }
        var key = iso(date);
        var hits = marks.filter(function (m) { return Object.prototype.hasOwnProperty.call(m.days, key); });
        var inSpan = marks.some(function (m) {
          return m.spans.some(function (sp) { return key >= sp.from && key <= sp.to; });
        });
        var openable = hits.length || inSpan;

        var cell = document.createElement(openable ? "button" : "div");
        cell.className = "cna-cal-cell" +
          (key === todayIso ? " cna-cal-today" : "") +
          (key === picked ? " cna-cal-picked" : "");
        if (openable) {
          cell.type = "button";
          cell.addEventListener("click", function () {
            picked = (picked === key) ? null : key;
            paint();
          });
        }

        var n = document.createElement("span");
        n.className = "cna-cal-n";
        n.textContent = date.getDate();
        cell.appendChild(n);

        var dots = document.createElement("span");
        dots.className = "cna-cal-dots";
        hits.forEach(function (m) {
          var dot = document.createElement("i");
          dot.style.background = m.colour;
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
        return cell;
      }

      for (var w = 0; w < cells.length; w += 7) {
        var row = cells.slice(w, w + 7);

        var weekEl = document.createElement("div");
        weekEl.className = "cna-cal-week-row";

        var daysEl = document.createElement("div");
        daysEl.className = "cna-cal-days";
        row.forEach(function (date) { daysEl.appendChild(drawCell(date)); });
        weekEl.appendChild(daysEl);

        /* every run of days that touches this week gets its own line */
        var real = row.filter(Boolean);
        if (real.length) {
          var rowFrom = iso(real[0]), rowTo = iso(real[real.length - 1]);
          marks.forEach(function (m) {
            m.spans.forEach(function (sp) {
              if (sp.to < rowFrom || sp.from > rowTo) return;
              var startCol = -1, endCol = -1;
              row.forEach(function (date, idx) {
                if (!date) return;
                var k = iso(date);
                if (k >= sp.from && k <= sp.to) {
                  if (startCol === -1) startCol = idx;
                  endCol = idx;
                }
              });
              if (startCol === -1) return;

              var barsEl = document.createElement("div");
              barsEl.className = "cna-cal-bars";
              var bar = document.createElement("span");
              bar.className = "cna-cal-bar" +
                (sp.from >= rowFrom ? " cna-cal-bar-opens" : "") +
                (sp.to <= rowTo ? " cna-cal-bar-closes" : "");
              bar.style.background = m.colour;
              bar.style.gridColumn = (startCol + 1) + " / " + (endCol + 2);
              barsEl.appendChild(bar);
              weekEl.appendChild(barsEl);
            });
          });
        }

        grid.appendChild(weekEl);
      }
      /* Swipe the grid sideways to move a week or a month. Only a
         decidedly horizontal drag counts, so scrolling the page down
         through it still works, and a swipe that started on a day must
         not also open that day — the click after it is swallowed. */
      (function () {
        var x0 = 0, y0 = 0, tracking = false, swiped = false;
        grid.addEventListener("pointerdown", function (ev) {
          if (!ev.isPrimary) return;
          x0 = ev.clientX; y0 = ev.clientY; tracking = true; swiped = false;
        });
        grid.addEventListener("pointerup", function (ev) {
          if (!tracking) return;
          tracking = false;
          var dx = ev.clientX - x0, dy = ev.clientY - y0;
          if (Math.abs(dx) < 45 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
          swiped = true;
          step(dx < 0 ? 1 : -1);        /* drag left goes forward */
        });
        grid.addEventListener("pointercancel", function () { tracking = false; });
        grid.addEventListener("click", function (ev) {
          if (!swiped) return;
          swiped = false;
          ev.stopPropagation();
          ev.preventDefault();
        }, true);
      })();

      box.appendChild(grid);

      /* ---- the day tapped open ---- */
      if (picked) {
        var hits2 = marks.filter(function (m) { return Object.prototype.hasOwnProperty.call(m.days, picked); });
        /* a day inside a run of days reads out too, with the run's own words */
        marks.forEach(function (m) {
          m.spans.forEach(function (sp) {
            if (picked < sp.from || picked > sp.to) return;
            hits2.push({ label: m.label, colour: m.colour, go: m.go, days: (function () {
              var one = {}; one[picked] = sp.detail; return one;
            })() });
          });
        });
        if (hits2.length) {
          var line = document.createElement("div");
          line.className = "cna-cal-detail";
          var p = picked.split("-");
          var when = document.createElement("span");
          when.className = "cna-cal-detail-day";
          when.textContent = (+p[2]) + " " + MONTHS[+p[1] - 1];
          line.appendChild(when);
          /* Each activity is the way into the app that logged it. A day
             can hold several — drove, parked and worked late are three
             different apps — so the day itself cannot lead anywhere in
             particular; the activity can, and does. */
          hits2.forEach(function (m) {
            var bit = document.createElement(m.go ? "a" : "span");
            bit.className = "cna-cal-detail-bit";
            if (m.go) bit.setAttribute("href", m.go);

            var dot = document.createElement("i");
            dot.style.background = m.colour;
            bit.appendChild(dot);

            var txt = document.createElement("span");
            txt.textContent = m.days[picked] ? m.label + " " + m.days[picked] : m.label;
            bit.appendChild(txt);

            if (m.go) {
              var go = document.createElement("b");
              go.setAttribute("aria-hidden", "true");
              go.textContent = "\u203a";
              bit.appendChild(go);
            }
            line.appendChild(bit);
          });
          box.appendChild(line);
        }
      }

      /* ---- legend, and month stepping ---- */
      var foot = document.createElement("div");
      foot.className = "cna-cal-foot";

      /* the arrows stay alongside the swipe: a swipe cannot be reached
         from a keyboard, and nothing on screen would otherwise say that
         moving between weeks is possible at all */
      var nav = document.createElement("div");
      nav.className = "cna-cal-nav";
      [["‹", -1], ["›", 1]].forEach(function (pair) {
        var b = document.createElement("button");
        b.type = "button";
        b.textContent = pair[0];
        b.setAttribute("aria-label",
          (pair[1] < 0 ? "Previous " : "Next ") + (expanded ? "month" : "week"));
        b.addEventListener("click", function () { step(pair[1]); });
        nav.appendChild(b);
      });
      if (!onNow) {
        var back = document.createElement("button");
        back.type = "button";
        back.className = "cna-cal-back";
        back.textContent = "Today";
        back.addEventListener("click", function () {
          cursor = new Date(today.getFullYear(), today.getMonth(), today.getDate());
          picked = null;
          paint();
        });
        nav.appendChild(back);
      }
      foot.appendChild(nav);

      var legend = document.createElement("div");
      legend.className = "cna-cal-legend";
      /* nothing logged yet means nothing to explain */
      marks.forEach(function (m) {
        var s = document.createElement("span");
        var dot = document.createElement("i");
        dot.style.background = m.colour;
        s.appendChild(dot);
        var t = document.createElement("span");
        t.textContent = m.label;
        s.appendChild(t);
        legend.appendChild(s);
      });
      foot.appendChild(legend);
      box.appendChild(foot);
    }

    paint();
    document.addEventListener("visibilitychange", function () {
      if (!document.hidden) { picked = null; paint(); }
    });
    window.addEventListener("pageshow", function () { picked = null; paint(); });
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
      var placed = {};
      saved.forEach(function (id) {
        var tile = grid.querySelector('[data-app-id="' + id + '"]');
        if (tile) { grid.appendChild(tile); placed[id] = true; }
      });
      /* An app added since the order was saved is not in that list, so
         moving every saved tile to the end above left the new one stranded
         at the front — in front of an arrangement someone had chosen by
         hand. Send anything unplaced to the end, where a newly installed
         app belongs, keeping the order they appear in the page. */
      tiles().forEach(function (tile) {
        if (!placed[tile.dataset.appId]) grid.appendChild(tile);
      });
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
     The small window

     One window, reused. It is filled by whatever opens it, closes on
     the cross, the backdrop or Escape, and hands focus back to the
     button that opened it.
     ------------------------------------------------------------------ */

  var modalOpener = null;
  var repaintCalPicks = null;

  function openModal(title, body) {
    var box = document.getElementById("cna-modal");
    if (!box) return;
    document.getElementById("cna-modal-title").textContent = title;
    var slot = document.getElementById("cna-modal-body");
    slot.textContent = "";
    slot.appendChild(body);
    slot.scrollTop = 0;
    box.hidden = false;
    /* Focus the window itself rather than its cross. A screen reader still
       announces the window, and a thumb does not get a focus ring drawn
       round a button it never pressed. */
    box.querySelector(".cna-sheet").focus();
  }

  function closeModal() {
    var box = document.getElementById("cna-modal");
    if (!box || box.hidden) return;
    box.hidden = true;
    document.getElementById("cna-modal-body").textContent = "";
    if (modalOpener) { try { modalOpener.focus(); } catch (e) {} }
    modalOpener = null;
  }

  function initModal() {
    var box = document.getElementById("cna-modal");
    if (!box) return;
    document.getElementById("cna-modal-close").addEventListener("click", closeModal);
    /* the backdrop only, never a press that landed inside the sheet */
    box.addEventListener("click", function (e) { if (e.target === box) closeModal(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeModal();
    });
  }

  /* ------------------------------------------------------------------
     What's new

     Written by hand, in the words someone using the app would use.
     Newest first, and only the recent ones — this is a note about what
     changed lately, not a history of the whole build.
     ------------------------------------------------------------------ */

  var RELEASES = [
    {
      when: "9 September 2026",
      what: "Back up everything from one place",
      points: [
        "Backup and Restore have moved to Settings on the main page. One press covers every app, or tick just the ones you want.",
        "The Backup buttons inside Driving Log, OT Tracker and Taxi Claims are gone. Each app still writes its own backup in its own format — the main page asks for it rather than reading their records.",
        "Save the file to iCloud Drive rather than On My iPhone, and losing the phone no longer loses the backup with it.",
        "Restoring still offers Add missing only, so bringing an old backup onto a phone in use never wipes what is already there.",
        "Settings folds into one screen: Calendar, Backup and App updates now show their state on the closed row."
      ]
    },
    {
      when: "7 September 2026",
      what: "A cleaner home screen, and fixes",
      points: [
        "The home screen was tidied: one set of text sizes, even columns of figures, the settings button on the date line, and everything in matching panels.",
        "Tap a day on the calendar and each thing logged that day is now a way straight into the app that logged it.",
        "This list now covers the app itself, not only the four inside it — Settings shows its version and offers the reload when a new one is waiting.",
        "Add to Calendar: on a phone that will not hand the file over by itself, there is now a link to press instead of nothing happening."
      ]
    },
    {
      when: "7 September 2026",
      what: "Home button, and your days in the calendar",
      points: [
        "Home is now the first tab along the bottom of Driving Log, OT Tracker and Taxi Claims, where your thumb already sits. The old link across the top is gone.",
        "Settings can send your logged days to the phone's own Calendar. Tick the activities you want and press the button.",
        "This list. Press What's new any time to see what changed."
      ]
    },
    {
      when: "6 September 2026",
      what: "Colour means the activity",
      points: [
        "Driving is yellow, parking blue, overtime green, taxi purple — the same colour on the home screen calendar as inside the app it came from.",
        "The Parking tab inside Driving Log turns blue, so a blue dot and a blue screen match.",
        "A trip lasting several days can draw as one line across those dates instead of a dot on each."
      ]
    },
    {
      when: "5 September 2026",
      what: "Restoring a backup no longer wipes what is already here",
      points: [
        "Restoring now offers Add missing only, which brings in what the phone is missing and leaves everything already logged alone.",
        "Replace everything is still there when that is genuinely what you want.",
        "Restoring the same file twice changes nothing the second time."
      ]
    },
    {
      when: "4 September 2026",
      what: "Taxi Claims split out, and a calendar on the home screen",
      points: [
        "Taxi rides moved into their own app. Everything already logged came across on its own, receipts included.",
        "DOT.log is now called Driving Log. Nothing inside it changed.",
        "The home screen shows the week, coloured by what happened each day. Swipe sideways to move through the months.",
        "The figures cover this month only and start clean each month, except money still unclaimed from before, which keeps its own line.",
        "Every app can back itself up, and says so when a month has gone by without one."
      ]
    },
    {
      when: "3 September 2026",
      what: "OT Tracker split out",
      points: [
        "Overtime moved out of the driving log into its own app, with the pay rules and the rate calculator.",
        "Every hour already logged came across. Nothing had to be re-typed.",
        "The home screen started showing this month's figures above the app icons."
      ]
    }
  ];

  function buildNews() {
    var wrap = document.createElement("div");
    RELEASES.forEach(function (r) {
      var when = document.createElement("p");
      when.className = "cna-news-when";
      when.textContent = r.when;
      wrap.appendChild(when);

      var what = document.createElement("p");
      what.className = "cna-news-what";
      what.textContent = r.what;
      wrap.appendChild(what);

      var ul = document.createElement("ul");
      ul.className = "cna-news-points";
      r.points.forEach(function (t) {
        var li = document.createElement("li");
        li.textContent = t;
        ul.appendChild(li);
      });
      wrap.appendChild(ul);
    });
    return wrap;
  }

  /* ------------------------------------------------------------------
     Sending days to the phone's own calendar

     Built from the very same summaries the home screen calendar reads,
     so no sub-app has to be changed, or even know this exists.

     A calendar file is a handover, not a live link: pressing the button
     hands the phone a copy of the days as they stand. Doing it again
     later hands over a fresh copy. Every day carries an id built from the app,
     the activity and the date, so the second copy lands on top of the
     first rather than beside it.
     ------------------------------------------------------------------ */

  var CAL_PICKS_KEY = "cna.calendarPicks.v1";

  function readPicks() {
    try {
      var v = JSON.parse(localStorage.getItem(CAL_PICKS_KEY) || "{}");
      return v && typeof v === "object" ? v : {};
    } catch (e) { return {}; }
  }

  function writePicks(v) {
    try { localStorage.setItem(CAL_PICKS_KEY, JSON.stringify(v)); } catch (e) {}
  }

  /* Folded at 75 octets, counted in bytes rather than letters, because a
     name with an accent in it takes two. A continuation line begins with
     one space, which counts towards its own 75. */
  function icsFold(line) {
    var enc = window.TextEncoder ? new TextEncoder() : null;
    function width(ch) { return enc ? enc.encode(ch).length : ch.length; }
    var out = [], cur = "", n = 0, limit = 74;
    Array.from(line).forEach(function (ch) {
      var w = width(ch);
      if (n + w > limit) { out.push(cur); cur = ""; n = 1; limit = 74; }
      cur += ch; n += w;
    });
    out.push(cur);
    return out.join("\r\n ");
  }

  function icsText(s) {
    return String(s)
      .replace(/\\/g, "\\\\")
      .replace(/;/g, "\\;")
      .replace(/,/g, "\\,")
      .replace(/\r?\n/g, "\\n");
  }

  /* An all-day event ends on the morning after its last day, so a single
     day runs from that date to the next one. Stepped in UTC: stepping a
     local date over a clock change lands on the same day twice. */
  function dayAfter(iso) {
    var b = iso.split("-");
    var d = new Date(Date.UTC(+b[0], +b[1] - 1, +b[2] + 1));
    return d.toISOString().slice(0, 10);
  }

  function stamp() {
    return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  }

  function buildIcs(marks, picks) {
    var now = stamp();
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//CNA Apps//Calendar//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:CNA Apps"
    ];
    var count = 0;

    function event(mark, from, to, detail) {
      var title = detail ? mark.label + " " + detail : mark.label;
      lines.push(
        "BEGIN:VEVENT",
        "UID:cna-" + mark.app + "-" + mark.key + "-" + from.replace(/-/g, "") + "@cna-apps",
        "DTSTAMP:" + now,
        "LAST-MODIFIED:" + now,
        "DTSTART;VALUE=DATE:" + from.replace(/-/g, ""),
        "DTEND;VALUE=DATE:" + dayAfter(to).replace(/-/g, ""),
        icsFold("SUMMARY:" + icsText(title)),
        "TRANSP:TRANSPARENT",
        "END:VEVENT"
      );
      count++;
    }

    marks.forEach(function (m) {
      if (picks[m.app + ":" + m.key] === false) return;
      Object.keys(m.days).sort().forEach(function (iso) {
        event(m, iso, iso, m.days[iso]);
      });
      m.spans.forEach(function (sp) { event(m, sp.from, sp.to, sp.detail); });
    });

    lines.push("END:VCALENDAR");
    return { text: lines.join("\r\n") + "\r\n", count: count };
  }

  /* Handed to the phone's share sheet where there is one, which is what
     puts Calendar in the list on an iPhone. It has to be asked for inside
     the press itself — a share asked for after any waiting is refused.

     Where that is not available, or refuses, the file is offered as a
     link for the person to tap. It is deliberately NOT a link this code
     taps for them: a page added to the home screen runs without a browser
     around it, and a tap made by script there is very often ignored with
     no error at all — which is exactly the "nothing happens" this used to
     produce. A link somebody presses themselves always works.

     Whichever route it takes, it says which, so a phone that will not
     play along can be described rather than guessed at. */
  function handOver(text, onFallback) {
    var blob = new Blob([text], { type: "text/calendar;charset=utf-8" });
    var file = null;
    try { file = new File([blob], "CNA Apps.ics", { type: "text/calendar" }); } catch (e) {}

    function offerLink(why) {
      var url = URL.createObjectURL(blob);
      onFallback(url, why);
      /* left alive: the link is only useful for as long as it is on screen */
      return why;
    }

    if (!file || !navigator.share) return Promise.resolve(offerLink("no-share"));

    /* canShare is the polite question, but some phones answer it wrongly
       or do not have it at all, so a no from it is not taken as final. */
    var welcome = true;
    try {
      if (navigator.canShare) welcome = navigator.canShare({ files: [file] });
    } catch (e) { welcome = false; }

    if (!welcome) return Promise.resolve(offerLink("share-refused-file"));

    return navigator.share({ files: [file], title: "CNA Apps" })
      .then(function () { return "shared"; })
      .catch(function (err) {
        if (err && err.name === "AbortError") return "cancelled";
        return offerLink("share-failed");
      });
  }

  function initCalendarExport() {
    var picksBox = document.getElementById("cna-cal-picks");
    var sendBtn = document.getElementById("cna-cal-send");
    var note = document.getElementById("cna-cal-note");
    var fallback = document.getElementById("cna-cal-fallback");
    if (!picksBox || !sendBtn) return;

    var marks = [];

    function paint() {
      marks = readMarks();
      var picks = readPicks();
      picksBox.textContent = "";
      note.hidden = true;
      if (fallback) { fallback.textContent = ""; fallback.hidden = true; }

      var meta = document.getElementById("cna-cal-meta");
      if (!marks.length) {
        var empty = document.createElement("p");
        empty.className = "cna-empty";
        empty.textContent = "Nothing logged yet.";
        picksBox.appendChild(empty);
        sendBtn.disabled = true;
        if (meta) meta.textContent = "nothing logged yet";
        return;
      }
      if (meta) {
        var on = marks.filter(function (m) { return picks[m.app + ":" + m.key] !== false; }).length;
        meta.textContent = on + " of " + marks.length + " ticked";
      }

      marks.forEach(function (m) {
        var id = m.app + ":" + m.key;
        var row = document.createElement("label");
        row.className = "cna-check";

        var box = document.createElement("input");
        box.type = "checkbox";
        box.checked = picks[id] !== false;      /* new activities start ticked */
        box.addEventListener("change", function () {
          var now = readPicks();
          now[id] = box.checked;
          writePicks(now);
          sendBtn.disabled = !anyTicked();
        });

        var dot = document.createElement("i");
        dot.style.background = m.colour;

        var name = document.createElement("span");
        var days = Object.keys(m.days).length + m.spans.length;
        name.textContent = m.label + " · " + days + (days === 1 ? " day" : " days");

        row.appendChild(box);
        row.appendChild(dot);
        row.appendChild(name);
        picksBox.appendChild(row);
      });

      sendBtn.disabled = !anyTicked();
    }

    function anyTicked() {
      return [].some.call(picksBox.querySelectorAll("input"), function (b) { return b.checked; });
    }

    function days(n) { return n + (n === 1 ? " day" : " days"); }

    /* Shown when the phone will not take the file by itself. A real link,
       waiting to be pressed, rather than one this code presses. */
    function showLink(url, count) {
      if (!fallback) return;
      fallback.textContent = "";
      var a = document.createElement("a");
      a.className = "cna-btn cna-btn-link";
      a.href = url;
      a.download = "CNA Apps.ics";
      a.type = "text/calendar";
      a.rel = "noopener";
      a.textContent = "Open the file with " + days(count);
      fallback.appendChild(a);
      fallback.hidden = false;
    }

    sendBtn.addEventListener("click", function () {
      if (fallback) { fallback.textContent = ""; fallback.hidden = true; }

      var built = buildIcs(marks, readPicks());
      if (!built.count) {
        note.hidden = false;
        note.textContent = "Nothing ticked has any days in it yet.";
        return;
      }
      note.hidden = false;
      note.textContent = "Preparing " + days(built.count) + "\u2026";

      handOver(built.text, function (url, why) { showLink(url, built.count); })
        .then(function (how) {
          if (how === "cancelled") {
            note.textContent = "Left it. Nothing was sent.";
            return;
          }
          if (how === "shared") {
            note.textContent = days(built.count) + " handed over. Choose Calendar to add them.";
            return;
          }
          /* every remaining answer means the link below is the way in */
          note.textContent = "This phone will not hand the file over on its own. "
            + "Press below, then choose Calendar.";
        })
        .catch(function () {
          note.textContent = "Could not prepare the file. Try again.";
        });
    });

    paint();
    return paint;
  }

  /* ------------------------------------------------------------------
     Backup, for every app at once

     The rule this page lives by is that it never reads another app's
     storage. Backing up looks like the one job that would have to break
     it — and it does not.

     Instead this asks. Each app is opened out of sight, just long enough
     to hear the question and answer it, and what comes back is a
     finished file this page never opens. Driving Log still decides what
     a Driving Log backup contains, in its own format, with its own rules
     for putting one back. Rebuild it tomorrow and its backup changes
     with it, with nothing here to alter.

     The cost is a page load per app, which is why it happens on a press
     rather than in the background.
     ------------------------------------------------------------------ */

  var BACKUP_APPS = ["dot", "otlog", "taxi"];   /* Overseas Tracker is Nantha's and keeps its own arrangements */
  var ASK_TIMEOUT_MS = 60000;                   /* a full backup with photos is slow, not stuck */
  var askSeq = 0;

  /* Opens one app out of sight, asks it one question, takes it down
     again. Never rejects: a silent app is an answer too, and the caller
     needs to say which app went quiet rather than fail the lot. */
  function askApp(id, question) {
    return new Promise(function (resolve) {
      var host = document.getElementById("cna-askers");
      if (!host) { resolve({ ok: false, app: id, error: "nowhere to ask from" }); return; }

      var token = "ask" + (++askSeq) + "-" + Date.now();
      var frame = document.createElement("iframe");
      frame.setAttribute("title", id);
      frame.setAttribute("aria-hidden", "true");
      frame.style.cssText = "position:absolute;width:1px;height:1px;opacity:0;border:0;left:-9999px;top:0";
      frame.src = at(id + "/");

      var done = false;
      function finish(payload) {
        if (done) return;
        done = true;
        clearTimeout(timer);
        window.removeEventListener("message", onMessage);
        try { host.removeChild(frame); } catch (e) {}
        resolve(payload);
      }

      var timer = setTimeout(function () {
        finish({ ok: false, app: id, error: "no answer" });
      }, ASK_TIMEOUT_MS);

      function onMessage(e) {
        if (e.origin !== location.origin) return;
        var msg = e.data;
        if (!msg || msg.cna !== "backup-reply" || msg.id !== token) return;
        msg.app = msg.app || id;
        finish(msg);
      }
      window.addEventListener("message", onMessage);

      frame.addEventListener("load", function () {
        var payload = { cna: "backup", id: token };
        Object.keys(question).forEach(function (k) { payload[k] = question[k]; });
        try { frame.contentWindow.postMessage(payload, location.origin); }
        catch (e) { finish({ ok: false, app: id, error: "could not ask" }); }
      });
      frame.addEventListener("error", function () {
        finish({ ok: false, app: id, error: "would not open" });
      });

      host.appendChild(frame);
    });
  }

  /* How old the oldest backup is, read from what each app publishes in
     its own card. No storage is touched to work this out. */
  function backupAges() {
    var out = [];
    BACKUP_APPS.forEach(function (id) {
      var card;
      try { card = JSON.parse(localStorage.getItem("cna.card." + id) || "null"); }
      catch (e) { return; }
      if (!card) return;
      out.push({
        id: id,
        name: String(card.name || id).slice(0, 24),
        at: typeof card.backupAt === "number" ? card.backupAt : null,
        hasData: !!card.hasData
      });
    });
    return out;
  }

  function ageDays(at) {
    if (!at) return null;
    return Math.floor((Date.now() - at) / 86400000);
  }

  function initBackup() {
    var listBox = document.getElementById("cna-backup-list");
    var ageLine = document.getElementById("cna-backup-age");
    var allBtn = document.getElementById("cna-backup-all");
    var restoreBtn = document.getElementById("cna-restore");
    var note = document.getElementById("cna-backup-note");
    var files = document.getElementById("cna-backup-files");
    var fullBox = document.getElementById("cna-backup-full");
    var fileInput = document.getElementById("cna-restore-file");
    if (!listBox || !allBtn) return;

    var known = [];

    function clearOutput() {
      note.hidden = true;
      note.textContent = "";
      files.textContent = "";
      files.hidden = true;
    }

    function paint() {
      known = backupAges();
      listBox.textContent = "";
      clearOutput();

      if (!known.length) {
        var empty = document.createElement("p");
        empty.className = "cna-empty";
        empty.textContent = "Open an app once and it will show up here.";
        listBox.appendChild(empty);
        allBtn.disabled = true;
        ageLine.textContent = "";
        return;
      }

      /* the state of the worst of them, said on the closed row, so the
         page answers "am I backed up" without being opened */
      var withData = known.filter(function (a) { return a.hasData; });
      var never = withData.filter(function (a) { return !a.at; });
      var oldest = withData.filter(function (a) { return a.at; })
        .sort(function (a, b) { return a.at - b.at; })[0];
      if (!withData.length) ageLine.textContent = "nothing logged yet";
      else if (never.length) ageLine.textContent = never.length === withData.length
        ? "never" : never.length + " never done";
      else {
        var d = ageDays(oldest.at);
        ageLine.textContent = d === 0 ? "backed up today"
          : d === 1 ? "1 day ago" : d + " days ago";
      }

      known.forEach(function (app) {
        var row = document.createElement("label");
        row.className = "cna-check";

        var box = document.createElement("input");
        box.type = "checkbox";
        box.checked = true;
        box.value = app.id;
        box.addEventListener("change", function () {
          allBtn.disabled = !listBox.querySelector("input:checked");
        });

        var name = document.createElement("span");
        var d = ageDays(app.at);
        name.textContent = app.name + " · " + (d === null ? "never backed up"
          : d === 0 ? "backed up today" : "backed up " + d + " days ago");

        row.appendChild(box);
        row.appendChild(name);
        listBox.appendChild(row);
      });
      allBtn.disabled = false;
    }

    function ticked() {
      return [].map.call(listBox.querySelectorAll("input:checked"), function (b) { return b.value; });
    }

    /* A file to press, never one this code presses. A page added to the
       home screen runs with no browser around it, and a press made by
       script there is very often ignored with no error at all. */
    function offerFile(blob, filename, label) {
      var a = document.createElement("a");
      a.className = "cna-btn cna-btn-link";
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.rel = "noopener";
      a.textContent = label;
      files.appendChild(a);
      files.hidden = false;
    }

    allBtn.addEventListener("click", function () {
      var want = ticked();
      if (!want.length) return;
      clearOutput();
      note.hidden = false;
      note.textContent = "Asking " + want.length + (want.length === 1 ? " app…" : " apps…");
      allBtn.disabled = true;

      var kind = fullBox && fullBox.checked ? "full" : "plain";
      var got = 0, failed = [];

      /* one at a time: a full backup is heavy and three at once on a
         phone is how you get one of them killed */
      (function next(i) {
        if (i >= want.length) {
          allBtn.disabled = false;
          note.textContent = got
            ? "Ready — press each file below to save it. Choose iCloud Drive."
              + (failed.length ? " Couldn't reach " + failed.join(", ") + "." : "")
            : "Couldn't reach " + failed.join(", ") + ".";
          paintAges();
          return;
        }
        var id = want[i];
        var asking = known.filter(function (a) { return a.id === id; })[0];
        note.textContent = "Asking " + (asking ? asking.name : id) +
          "… (" + (i + 1) + " of " + want.length + ")";
        askApp(id, { ask: "backup", kind: kind }).then(function (res) {
          var owner = known.filter(function (a) { return a.id === id; })[0];
          var shown = owner ? owner.name : id;
          if (res && res.ok && res.blob) {
            got++;
            offerFile(res.blob, res.filename || (id + "-backup.json"),
              shown + (res.note ? " — " + res.note : ""));
          } else {
            failed.push(shown);
          }
          next(i + 1);
        });
      })(0);
    });

    /* the ages come from the cards, which the apps rewrite as they answer */
    function paintAges() {
      var fresh = backupAges();
      fresh.forEach(function (app, i) {
        var rows = listBox.querySelectorAll(".cna-check span");
        if (!rows[i]) return;
        var d = ageDays(app.at);
        rows[i].textContent = app.name + " · " + (d === null ? "never backed up"
          : d === 0 ? "backed up today" : "backed up " + d + " days ago");
      });
    }

    /* ---- restore ----
       The file is offered to each app in turn until one recognises it,
       so there is nothing to choose and nothing to get wrong. The app
       that owns it decides what is in it and how to put it back. */
    restoreBtn.addEventListener("click", function () { fileInput.click(); });

    fileInput.addEventListener("change", function () {
      var f = this.files[0];
      this.value = "";
      if (!f) return;
      clearOutput();
      note.hidden = false;
      note.textContent = "Reading the file…";

      var reader = new FileReader();
      reader.onload = function () {
        var text = String(reader.result || "");
        (function findOwner(i) {
          if (i >= BACKUP_APPS.length) {
            note.textContent = "No app here recognises that file.";
            return;
          }
          var id = BACKUP_APPS[i];
          askApp(id, { ask: "describe", text: text }).then(function (res) {
            if (!res || !res.ok) { findOwner(i + 1); return; }
            var owner = known.filter(function (a) { return a.id === id; })[0];
            var ownerName = owner ? owner.name : id;
            note.textContent = ownerName + " backup — " + res.summary;
            askMode(id, ownerName, text, res.summary);
          });
        })(0);
      };
      reader.onerror = function () { note.textContent = "Could not read that file."; };
      reader.readAsText(f);
    });

    function askMode(id, name, text, summary) {
      var body = document.createElement("div");

      var p = document.createElement("p");
      p.className = "cna-note";
      p.style.marginTop = "0";
      p.textContent = "This holds " + summary + ". Add missing only keeps everything already on "
        + "this phone and fills the gaps. Replace everything wipes what is here first — only "
        + "use that on a phone with nothing on it yet. No other app is touched either way.";
      body.appendChild(p);

      function run(mode, label) {
        var b = document.createElement("button");
        b.className = "cna-btn";
        b.type = "button";
        b.style.marginTop = "10px";
        b.textContent = label;
        b.addEventListener("click", function () {
          closeModal();
          note.hidden = false;
          note.textContent = "Restoring into " + name + "…";
          askApp(id, { ask: "restore", text: text, mode: mode }).then(function (res) {
            var said = res && res.ok
              ? name + ": " + (res.message || "restored")
              : name + ": " + ((res && (res.message || res.error)) || "could not restore");
            initStrip();
            initTodos();
            /* repaint first — it clears whatever the panel was saying —
               then say what happened, or the answer is wiped the moment
               it arrives */
            paint();
            note.hidden = false;
            note.textContent = said;
          });
        });
        body.appendChild(b);
      }
      run("merge", "Add missing only");
      run("replace", "Replace everything");

      modalOpener = restoreBtn;
      openModal("Restore into " + name + "?", body);
    }

    paint();
    return paint;
  }

  /* ------------------------------------------------------------------
     Settings screen — only present on the home screen
     ------------------------------------------------------------------ */

  var APPS = [
    { id: "dot", name: "Driving Log" },
    { id: "otlog", name: "OT Tracker" },
    { id: "taxi", name: "Taxi Claims" },
    { id: "ot", name: "Overseas Tracker" }
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
      if (settings) {
        refreshUpdates();
        if (repaintBackup) repaintBackup();
        /* day counts move as things are logged, so they are read fresh
           every time rather than left as they were on first load */
        if (repaintCalPicks) repaintCalPicks();
      }
    }
    openBtn.addEventListener("click", function () { show(true); });
    /* the home screen's own backup reminder opens this screen */
    openSettings = function () { show(true); };
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

    /* ---- the container's own line ----
       It updates by a different route from the apps it holds: there is no
       version file to fetch and no button to install one, because the new
       copy downloads itself and then waits. So this row reports what is
       installed, and offers the same reload the prompt at the bottom of
       the screen offers. Without it, Settings listed four apps and said
       nothing at all about the thing they live in. */
    var shellRow = document.getElementById("cna-shell-row");
    var shellHave = null;

    function paintShell() {
      if (!shellRow) return;
      shellRow.textContent = "";

      var el = document.createElement("div");
      el.className = "cna-update-row";

      var name = document.createElement("div");
      name.className = "cna-update-name";
      name.textContent = "CNA Apps";

      var state = document.createElement("span");
      state.className = "cna-update-state";
      var waiting = !!(reg && reg.waiting);
      state.textContent = !shellHave
        ? (waiting ? "Update ready" : "Checking\u2026")
        : "v" + shellHave + (waiting ? " \u00b7 update ready" : " \u00b7 up to date");
      name.appendChild(state);
      el.appendChild(name);

      if (waiting) {
        var btn = document.createElement("button");
        btn.className = "cna-update-btn";
        btn.type = "button";
        var armed = false;
        btn.textContent = "Reload";
        btn.addEventListener("click", function () {
          /* the same manners as the prompt: never swap a version out from
             under a half-typed entry without saying so first */
          if (hasUnsavedWork() && !armed) {
            armed = true;
            state.textContent = "You have an unsaved entry \u2014 reloading loses it";
            btn.textContent = "Reload anyway";
            return;
          }
          btn.disabled = true;
          btn.textContent = "Updating\u2026";
          reg.waiting.postMessage({ type: "SKIP_WAITING" });
        });
        el.appendChild(btn);
      }

      shellRow.appendChild(el);
    }
    repaintShellRow = paintShell;
    paintShell();

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

      /* Checking for updates should mean all of them. Without this the
         button only ever asked the four apps, and a waiting container
         release was found by accident on some later visit. */
      if (reg) { try { reg.update(); } catch (e) {} }

      Promise.all([ask({ type: "STATUS" })].concat(APPS.map(function (a) { return fetchVersionFile(a.id); })))
        .then(function (results) {
          var installed = results[0] || {};
          var offline = false;
          shellHave = installed.shell || null;
          paintShell();

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

          var meta = document.getElementById("cna-updates-meta");
          if (meta) {
            var waiting = list.querySelectorAll(".cna-update-btn:not([hidden])").length +
                          (reg && reg.waiting ? 1 : 0);
            meta.textContent = offline ? "couldn't check"
              : waiting ? waiting + (waiting === 1 ? " update ready" : " updates ready")
              : "all up to date";
          }
        });
    }

    function installApp(app, info, quiet) {
      setRow(app.id, quiet ? "Getting ready…" : "Updating…", null);
      return ask({ type: "INSTALL", id: app.id, version: info.version, build: info.build, files: info.files })
        .then(function (res) {
          if (res && res.ok) {
            setRow(app.id, "v" + String(res.version).split("-b")[0] + " · up to date", null);
          } else if (res && /^Unknown app: /.test(res.error || "")) {
            /* This home screen lists an app the offline worker still
               running has never heard of, because a container update is
               downloaded but has not been let in yet. Nothing is broken
               and a retry cannot help — only the reload can, so say that
               rather than showing a raw error with a dead Try again. */
            setRow(app.id, "Reload the app first, then update", null);
          } else {
            setRow(app.id, (res && res.error) ? "Update failed — " + res.error : "Update failed — check your connection", "Try again");
          }
        });
    }

    checkBtn.addEventListener("click", function () { refreshUpdates(); });

    var newsBtn = document.getElementById("cna-whats-new");
    if (newsBtn) {
      newsBtn.addEventListener("click", function () {
        modalOpener = newsBtn;
        openModal("What\u2019s new", buildNews());
      });
    }

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
    initStrip();
    initTodos();
    initCalendar();
    homeScreen = initHomeScreen();
    initModal();
    repaintCalPicks = initCalendarExport();
    repaintBackup = initBackup();
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
