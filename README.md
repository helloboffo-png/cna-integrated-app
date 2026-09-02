# CNA Apps

One app that holds several smaller apps, for the crew. No account, no server,
no database. Everything a person enters stays on their own phone.

Install it to the home screen and it works with no signal.

## What is in it

| App | What it does | Stored on the phone? |
|---|---|---|
| **DOT.log** | Log which company vehicle you drove and your overtime, export the monthly claim | Yes — works offline |
| **OT Builder** | Overseas assignment OT forms, signatures, PDF | Yes — works offline |
| **farmerswife** | Shortcut to the rostering site | No — it is a website, needs a connection |

## The rule this whole thing is built around

**Each app lives in its own folder and its own page. They never share one.**

Fix or upgrade one and the others do not move. That is not a happy accident;
it is the reason for nearly every decision here:

- Each app keeps its own HTML page, so one app's styling can never reach
  another's. DOT.log styles the whole page; OT Builder scopes to its own root.
  In one shared page those would collide.
- Each app has **its own offline store**, named after its own version
  (`cna-dot-v2.6.0`, `cna-ot-v1.4.0`). Refreshing one leaves the others
  untouched, byte for byte.
- Each app carries **its own version file**, so its owner ships releases
  without ever editing a file anyone else touches.

## Who owns what

| Area | Owner |
|---|---|
| DOT.log | Ben |
| OT Builder | Nantha |
| The container — home screen, settings, offline | Ben |

Neither owner edits the other's folder, and neither edits a shared file to
ship. There is nothing to coordinate.

## Shipping an update to one app

1. Replace the contents of that app's folder (`dot/` or `ot/`).
2. Bump `version` in that folder's `version.json`.
3. Push.

People then see **update ready** next to that app in Settings, with its own
button. Pressing it refreshes only that app.

Keep the handful of container lines in the app's `index.html` — the top bar,
the shared stylesheet and `shell.js`. They are marked with comments.

## Changing the container itself

The home screen, settings, stylesheet and `shell.js` are cached on people's
phones like everything else. After changing any of them, **bump
`SHELL_VERSION` at the top of `sw.js`**. That is what tells a phone to throw
away its stored copy and take the new one; without it, people keep seeing the
previous version. Sub-apps are unaffected either way — their stores are
separate and are never swept by a container release.

## Adding a new app later

1. Put it in its own folder, e.g. `payslips/`.
2. Give it a `version.json` listing its files.
3. Add a tile to `index.html` with a `data-app-id`.
4. Add it to `MODULE_PREFIXES` in `sw.js` and `APPS` in `shell.js`.

It then gets its own offline store and its own update button like the rest.
An app that is just a shortcut to a website — like farmerswife — needs only
the tile.

## Settings

Shared by every app: appearance (day / night / follow phone) and text size.
Both are written into each app's own preference in that app's own format, so
no app had to be changed to support them.

Hold an icon on the home screen to rearrange the apps.

## Running it locally

It is plain static files with no build step. Serve the folder with anything:

```bash
python3 -m http.server 3010
```

Then open `http://localhost:3010`.

## Troubleshooting

OT Builder has a hidden diagnostic panel — add `?otDebug=1` to its address:
`/ot/?otDebug=1`. It shows the app version, storage counts and a log of what
happened, with a button to copy it all out.

## Where the data lives

Nothing leaves the phone. There is no server to send it to.

- DOT.log: `driveotlog.v1` and a `dotlog-photos` database
- OT Builder: `otFormBuilder.*` and an `ot-form-builder-files` database

These do not overlap, so the apps cannot disturb each other's data. Back-ups
are the user's own responsibility — DOT.log has Backup and Restore in its
settings, and OT Builder saves projects as files.
