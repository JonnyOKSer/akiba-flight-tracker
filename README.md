# Akiba Flight Board

A neon Akihabara-styled flight tracker for a Tokyo trip. Tracks candidate flights,
compares fares, sets price targets, counts down to departure, and now **auto-tracks
real Google Flights prices daily** and **scans for the cheapest 7–10 day window** —
powered by SerpApi.

## What's in here

```
akiba-flight-tracker/
├── index.html                      the app (static; localStorage for your cards)
├── package.json                    declares @netlify/blobs for the functions
├── netlify.toml                    config (static publish + functions + esbuild)
└── netlify/
    ├── lib/
    │   └── tracker.mjs             shared: SerpApi calls + Blobs storage logic
    └── functions/
        ├── scheduled-track.mjs     daily cron: 1 search per route → history
        └── api.mjs                 browser API: state / refresh / best-dates / watchlist
```

## How it works

- **Hosting** is static — Netlify serves `index.html` directly.
- **Your cards** still live in the browser's `localStorage`.
- **Auto price tracking**: a Netlify Scheduled Function (`scheduled-track`) runs once a
  day, makes **one** SerpApi Google Flights search per watched route, and appends the
  lowest round-trip price to a per-route history in **Netlify Blobs**. The page reads
  that history and shows it as a live trend (cards get a **LIVE** badge).
- **Best-date scan**: clicking **FIND BEST DATES** on a card samples ~6 departure dates
  across the selected 3- or 6-month window and reports the cheapest one. This runs only
  when you click it, per route.
- **Quota readout**: the status bar shows how many SerpApi searches you have left, via
  SerpApi's free Account API.

## Quota math (the free plan is 250 searches/month)

- Daily cron = 1 search × number of routes. Two routes ≈ 60/month.
- Each **FIND BEST DATES** click ≈ 6 searches.
- Identical searches within an hour are served from cache and don't count.

So a couple of routes tracked daily plus the occasional date scan stays well under 250.
Add lots of routes or scan constantly and you'll hit the ceiling — the status bar warns
you as it drops.

## Deploy

1. Push this folder to Git (or drag it onto https://app.netlify.com/drop).
2. Netlify installs `@netlify/blobs` automatically (from `package.json`).
3. In **Site settings → Environment variables**, confirm `SERPAPI_KEY` is set
   (you've already done this).
4. Redeploy so the functions pick up the key.

## Test it

- Open the live site. The status bar should turn green: "Live tracking on · N searches left".
- Click **Refresh prices** — within a few seconds the watched cards should show live
  prices with a **LIVE** badge. (The daily cron will then keep them updated on its own.)
- Click **FIND BEST DATES** on a card to scan the window.
- Check the function manually: visit `https://YOUR-SITE.netlify.app/.netlify/functions/api?action=state`
  — you should get JSON back. If you see `{"error":"Server is missing SERPAPI_KEY."}`,
  the env var didn't take; re-add it and redeploy.
- Function logs: Netlify dashboard → Functions → `api` or `scheduled-track`.

## Notes

- The cron is set to 09:00 UTC in `scheduled-track.mjs` (`export const config`). Change the
  cron string to taste.
- SerpApi is a Google Flights data intermediary — great for a personal tracker, bound by
  their terms, not for reselling. Always confirm a fare on the airline before booking.
- You do **not** need Railway or any always-on server.
