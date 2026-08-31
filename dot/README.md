# DOT.log

A phone-first web app for logging which company vehicle you drove each day and your overtime hours, then exporting monthly (or multi-month) claims as a PDF.

- **No account, no login, no server.** Everything is stored locally on your own phone in the browser's `localStorage`. Nobody else — not even other people using this same site — can see your data.
- **Works offline.** Once you've opened it once, it keeps working with no internet connection at all.
- **Free.** It's a static site; there's nothing to buy or subscribe to.

## Using it

Open the site on your phone and add it to your home screen for the best experience:

- **iPhone (Safari):** open the link → Share icon → **Add to Home Screen**
- **Android (Chrome):** open the link → ⋮ menu → **Add to Home screen** / **Install app**

## For colleagues

Everyone who opens this link gets the same starting fleet of vehicle plates and pay rules pre-loaded, but each person's day-to-day entries are theirs alone — there's no shared database. If you update the site later, everyone's existing data survives; only the app code itself changes.

## Hosting this yourself

This is a fully static site (plain HTML/CSS/JS, zero build step, zero external dependencies) — deployed here via [GitHub Pages](https://pages.github.com/). To update it: edit `index.html` and push to the branch GitHub Pages is serving from.

Files:
- `index.html` — the entire app
- `manifest.json` — makes it installable as an app (PWA)
- `sw.js` — service worker that caches the app so it works offline
- `icon-*.png`, `apple-touch-icon.png`, `favicon-32.png` — app icons
