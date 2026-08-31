# CNA Integrated App — Job Sheet

**Date:** 31 August 2026
**Written for:** Bruce (owner) — plain language, no code talk
**Status:** awaiting approval. Nothing built yet.

---

## 1. What we are building

One app that holds several smaller apps.

Starting with two:

- **DOT.log** — log which company vehicle you drove, log overtime, export the monthly claim. Already live. Colleagues use it daily.
- **OT Builder** — overseas assignment overtime forms. Does the sums, takes signatures, makes the PDF.

Later you can add more. The whole design is built so adding a third or fourth is easy.

---

## 2. The one rule everything obeys

**Each app lives in its own room. Rooms never touch.**

If OT Builder breaks, DOT.log keeps running.
If DOT.log gets updated, OT Builder does not move.

This is not a nice-to-have. It is the reason the design looks the way it does.

---

## 3. Why not just merge them into one app

I looked inside both apps before deciding. Three real problems with merging:

**Paint spills.** DOT.log paints its look-and-feel across the whole page. OT Builder keeps its look inside its own box. Put them in one room and DOT.log's paint runs onto OT Builder. OT Builder would look wrong, and fixing that means going inside OT Builder — which you told me not to do.

**Two button bars.** Both apps put a bar of buttons at the bottom of the phone screen. In one room you get two bars stacked on top of each other. Confusing and ugly. The OT Builder's own instruction manual warns about exactly this.

**Tangled repairs.** One room means every fix risks the other app. That kills the whole point.

Separate rooms make all three problems disappear at once, without opening up either app.

---

## 4. What the app looks like to a user

**Front door.** Open the app, you land on a small menu page.

On it:

- A button for **DOT.log**
- A button for **OT Builder**
- **Appearance** — day mode / night mode / follow phone
- **Updates** — one line per app, showing if that app has a new version, each with its own Update button

Tap an app button, you go into that app. Full screen, exactly as it works today.

**Getting back.** A small **"← Apps"** button sits in the top-left corner of each app. One tap, back to the front door.

---

## 5. Appearance — one switch, both apps

Right now each app has its own day/night switch, kept in its own place.

The front door switch sets **both**, each in its own way. Neither app is opened up or changed. They simply wake up already in the right mode.

Each app keeps its own switch too, as a backup. Change it in either place, both agree.

**If this ever fails** (say a future OT Builder version stores its setting differently), nothing breaks — you just set that app's mode from inside that app, like today.

---

## 6. Updates — the part built around your two owners

**You own DOT.log updates. Your colleague owns OT Builder updates.**

The design makes it impossible for the two of you to collide.

### How it works

Each app carries **its own version card** inside its own folder. The card says:

- version number
- date
- one line on what changed
- the list of files that app needs

### What the user sees

On the front door, when there is internet:

```
DOT.log        v2.6    Update ready → v2.7     [ Update ]
OT Builder     v1.4    Up to date
```

Press **Update** on one line, only that app refreshes. The other app is not touched, not reloaded, not at risk.

If there is no internet, it just says when it last checked. Nothing breaks.

### Who edits what

| Job | Who | What they touch |
|---|---|---|
| Ship a new DOT.log | You | DOT.log's folder + DOT.log's version card |
| Ship a new OT Builder | Colleague | OT Builder's folder + OT Builder's version card |

**Neither of you ever edits the same file.** No coordination needed. No "did you push yet". Your colleague can ship OT Builder on a Tuesday without telling you.

### The safety rule kept from DOT.log

Your current app never swaps in a new version while someone is halfway through typing. It waits and asks first. **That behaviour is kept exactly as it is.**

---

## 7. Your colleagues' saved data

- **Nobody loses anything.** Not one entry, not one receipt, not one saved form.
- Old DOT.log data carries over on its own. No export, no import, no instructions to send anyone.
- The old DOT.log site **stays switched on** as a fallback while we test. If anything is wrong, people go back to it.
- Once you are happy, we point the old site at the new one.

**One thing to know:** while both sites are live, they read the same saved data. That is what makes the carry-over seamless. But it means you should pick one and stick to it fairly soon, so nobody is confused about which is the real one.

---

## 8. Works with no internet

Both apps keep working with no signal — on a plane, overseas, in a basement. Same as DOT.log does today.

The offline copy is kept **per app**. Refreshing OT Builder's copy leaves DOT.log's copy completely alone. This is what makes "update one app only" actually true rather than just a button that pretends.

---

## 9. How much I touch your two apps

This is the most important section. Judge the job on this.

**OT Builder — 4 lines changed in one file. Nothing else.**

The overtime maths, the PDF making, the signature drawing, the saving and loading of projects, the files list — **not one word changed**. Those files ship exactly as your colleague handed them over.

The 4 lines only say: which room I'm in, where the front door is, and where my version card lives.

**DOT.log — 5 lines changed in one file.**

The same 4, plus one line telling it to use the shared offline helper instead of its own.

*(I told you 3 lines each earlier. It went to 4 and 5 because you asked for the shared Appearance switch and the update centre — each app needs one extra line to reach those. Still nothing touched inside either app.)*

**Everything else is brand new** — the front door, the update system, the shared settings. New files. They add; they do not modify.

---

## 10. Troubleshooting stays easy

- OT Builder's hidden diagnostic mode still works, same as today. Add `?otDebug=1` to its address.
- Something wrong with one app → I work in that room only.
- A bad update → put the old folder back, change the version card. Two minutes. The other app never noticed.

---

## 11. What I check before saying it's done

**DOT.log**
- Log a drive. Add a receipt with a photo. Export a month PDF. Backup and restore.

**OT Builder**
- Build a form from a date range. Check the overtime sums are right.
- Make **both** PDF styles.
- Draw both signatures, confirm they land in the PDF.
- Save a project, close it, load it back.
- Leave a half-finished form, reopen, confirm it offers to resume.
- Open the diagnostic mode.

**The joins**
- Appearance switch on front door — both apps obey.
- Update one app — confirm the other app's stored copy is untouched.
- Cut the internet — both apps still open and work.
- Back button works from both apps.
- Install to phone home screen. Confirm it opens on the front door.

I do not report this as finished until I have actually run these and seen them pass.

---

## 12. Known limits — being straight with you

- **Switching apps is a full page load**, not an instant tab flick. It is fast and works offline, but it is a load. This is the price of the rooms never touching, and I think it is worth paying.
- **Front door needs internet to check for updates.** Offline it shows the last known state. The apps themselves still work fine offline.
- **Nothing is in the cloud.** Data lives on each person's own phone, same as today. Lose the phone, lose the data unless they backed up. Unchanged from how DOT.log works now, but worth saying out loud.
- **Version numbers are inconsistent right now.** The OT Builder folder is labelled v1.4, but inside, the app still says v1.3.0. Small thing, worth tidying so the update system reports honestly. I will raise it with your colleague rather than change it myself.

---

## 13. Order of work

1. Build the front door and the room structure. Both apps reachable, back button working.
2. Move both apps in. Full test of each, on its own, before going further.
3. Add the offline support, per app.
4. Add the shared Appearance switch.
5. Add the update system with the per-app buttons.
6. Full test pass from section 11.
7. Put it online at a new address. Old DOT.log stays live.

You see it working after step 2, not only at the end.

---

## Builder's notes

*Technical detail for whoever does the work. Bruce does not need to read this.*

**Layout**

```
/index.html          hub: launcher, appearance, update centre
/manifest.json       single PWA identity, scope = site root
/sw.js               single service worker
/shell.css           .cna-* classes only (back chip, hub styles)
/shell.js            appearance sync + update-centre logic
/dot/                DOT.log verbatim from DOT.log-site
/dot/version.json    { version, date, notes, files[] }
/ot/                 OT Builder verbatim from OT-Form-Builder/public
/ot/version.json     { version, date, notes, files[] }
```

**Module edits (exhaustive)**

`/ot/index.html` — manifest link → `../manifest.json`; add `../shell.css`; add back chip **outside** `#ot-form-builder`; add `../shell.js`. `app.js`, `styles.css`, `templates/`, `icons/` byte-identical. `/ot/sw.js` and `/ot/manifest.json` ship but are never registered or linked (INTEGRATION.md line 197).

`/dot/index.html` — same four, plus `navigator.serviceWorker.register("sw.js")` → `register("../sw.js", { scope: "../" })` at line 2882.

**Service worker**

Caches: `cna-shell-v<n>`, `cna-dot-v<n>`, `cna-ot-v<n>`. Version per module read from that module's `version.json` `files[]` — so a module owner never edits a shared file to ship. Fetch routes by path prefix into the matching cache, stale-while-revalidate, preserving DOT.log's current semantics. Activate deletes only caches whose module prefix is known and version differs.

**Do not name the OT cache `ot-form-builder-*`.** `disableServiceWorkerCaching()` in `app.js:1330` deletes any cache key with that prefix — it would wipe its own offline copy on every load.

Keep DOT.log's no-`skipWaiting()` discipline and its update-bar UI; promote that logic into `shell.js` so it serves both modules.

**Appearance bridge**

Hub writes each module's native preference slot: DOT.log → `settings.theme` inside the `driveotlog.v1` blob (values `light`/`dark`/`auto`); OT Builder → `otFormBuilder.theme` (values `light`/`dark`). Best-effort and wrapped — a schema change in either app degrades to each app's own toggle, never an error.

**Storage — verified disjoint, nothing to migrate**

DOT.log: localStorage `driveotlog.v1`, IndexedDB `dotlog-photos` v1.
OT Builder: localStorage `otFormBuilder.theme` / `.draft` (+ legacy fallbacks), IndexedDB `ot-form-builder-files` v2 (stores `pdfs`, `projects`), sessionStorage debug keys.

**Deployment**

New repo → `helloboffo-png.github.io/<repo>/`. Same origin as the existing `helloboffo-png.github.io/dot.log/`, so localStorage and IndexedDB carry over with no migration. Verified: no `CNAME` in the DOT.log repo, so it is a project site, not a custom domain. Service worker scopes are path-based, so the old and new workers do not fight.
