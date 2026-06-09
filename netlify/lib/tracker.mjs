// Shared tracking logic used by both the scheduled cron function and the API function.
// Talks to SerpApi (Google Flights data) and persists history in Netlify Blobs.

import { getStore } from "@netlify/blobs";

const SERP = "https://serpapi.com/search.json";
const ACCOUNT = "https://serpapi.com/account.json";
const apiKey = () => process.env.SERPAPI_KEY;

function db() {
  // strong consistency so a manual "refresh" is readable immediately after writing
  return getStore({ name: "akiba-tracker", consistency: "strong" });
}

// Sensible defaults if the browser hasn't synced a watchlist yet.
export const DEFAULT_WATCHLIST = [
  { route: "MCO-NRT", from: "MCO", to: "NRT", target_date: null, nights: 8 },
  { route: "MCO-HND", from: "MCO", to: "HND", target_date: null, nights: 8 },
];

// ---------- date helpers (all UTC, YYYY-MM-DD) ----------
const fmt = (d) => d.toISOString().slice(0, 10);
const today = () => fmt(new Date());
function addDays(dateStr, n) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + n);
  return fmt(d);
}

// ---------- watchlist ----------
export async function getWatchlist() {
  try {
    const v = await db().get("watchlist", { type: "json" });
    if (Array.isArray(v) && v.length) return v;
  } catch (_) {}
  return DEFAULT_WATCHLIST;
}

export async function setWatchlist(routes) {
  const seen = {};
  const out = [];
  for (const r of routes || []) {
    if (!r || !r.from || !r.to) continue;
    const route = (r.from + "-" + r.to).toUpperCase();
    if (seen[route]) continue;
    seen[route] = 1;
    out.push({
      route,
      from: String(r.from).toUpperCase(),
      to: String(r.to).toUpperCase(),
      target_date: r.target_date || null,
      nights: Number(r.nights) > 0 ? Number(r.nights) : 8,
    });
  }
  const finalList = out.length ? out : DEFAULT_WATCHLIST;
  await db().setJSON("watchlist", finalList);
  return finalList;
}

// ---------- one SerpApi Google Flights round-trip search ----------
async function searchRoute(from, to, outbound, ret) {
  const qs = new URLSearchParams({
    engine: "google_flights",
    departure_id: from,
    arrival_id: to,
    outbound_date: outbound,
    return_date: ret,
    type: "1", // 1 = round trip
    currency: "USD",
    hl: "en",
    gl: "us",
    api_key: apiKey(),
  });
  const r = await fetch(SERP + "?" + qs.toString());
  const data = await r.json();
  if (data.error) throw new Error(data.error);

  const ins = data.price_insights || null;
  let price = ins && ins.lowest_price != null ? ins.lowest_price : null;
  if (price == null && Array.isArray(data.best_flights) && data.best_flights[0])
    price = data.best_flights[0].price ?? null;
  if (price == null && Array.isArray(data.other_flights) && data.other_flights[0])
    price = data.other_flights[0].price ?? null;

  return { price, insights: ins };
}

// ---------- daily tracking: 1 search per route, append to history ----------
export async function runDailyTracking() {
  const s = db();
  const wl = await getWatchlist();
  const t = today();
  const results = [];

  for (const r of wl) {
    try {
      const outbound = r.target_date || addDays(t, 45); // ~45 days out by default
      const ret = addDays(outbound, r.nights || 8);
      const { price, insights } = await searchRoute(r.from, r.to, outbound, ret);

      const hk = "history:" + r.route;
      let hist = [];
      try { hist = (await s.get(hk, { type: "json" })) || []; } catch (_) {}
      hist = hist.filter((h) => h.t !== t); // one entry per day
      if (price != null) hist.push({ t, price, outbound, ret });
      if (hist.length > 120) hist = hist.slice(-120);
      await s.setJSON(hk, hist);

      if (insights) await s.setJSON("insights:" + r.route, { t, ...insights });
      results.push({ route: r.route, price, ok: true });
    } catch (e) {
      results.push({ route: r.route, ok: false, error: String(e.message || e) });
    }
  }

  await s.setJSON("lastRun", { t: new Date().toISOString(), results });
  return results;
}

// ---------- scan a window for the cheapest departure (on demand) ----------
export async function scanBestDates(route, months) {
  const s = db();
  const wl = await getWatchlist();
  const r = wl.find((x) => x.route === route);
  if (!r) throw new Error("Route not tracked: " + route);

  const m = months === 6 ? 6 : 3;
  const start = new Date();
  const end = new Date();
  end.setMonth(end.getMonth() + m);
  const startMs = start.getTime();
  const endMs = end.getTime();
  const nights = r.nights || 8;

  const SAMPLES = 6; // 6 searches per scan keeps the quota happy
  const points = [];
  let best = null;

  for (let i = 0; i < SAMPLES; i++) {
    const frac = (i + 1) / (SAMPLES + 1); // skip the extreme edges of the window
    const outbound = fmt(new Date(startMs + (endMs - startMs) * frac));
    const ret = addDays(outbound, nights);
    try {
      const { price } = await searchRoute(r.from, r.to, outbound, ret);
      if (price != null) {
        points.push({ outbound, ret, price });
        if (!best || price < best.price) best = { outbound, ret, price };
      }
    } catch (_) { /* skip a failed sample, keep going */ }
  }

  const out = { route, months: m, nights, best, points, t: new Date().toISOString() };
  await s.setJSON("best:" + route, out);
  return out;
}

// ---------- SerpApi account quota (free, doesn't count against quota) ----------
export async function getQuota() {
  try {
    const r = await fetch(ACCOUNT + "?api_key=" + encodeURIComponent(apiKey()));
    const d = await r.json();
    return {
      used: d.this_month_usage ?? null,
      limit: d.searches_per_month ?? null,
      left: d.plan_searches_left ?? d.total_searches_left ?? null,
    };
  } catch (_) {
    return null;
  }
}

// ---------- everything the front-end needs in one call ----------
export async function getState() {
  const s = db();
  const wl = await getWatchlist();
  const histories = {};
  const best = {};

  for (const r of wl) {
    try { histories[r.route] = (await s.get("history:" + r.route, { type: "json" })) || []; }
    catch (_) { histories[r.route] = []; }
    try { best[r.route] = (await s.get("best:" + r.route, { type: "json" })) || null; }
    catch (_) { best[r.route] = null; }
  }

  let lastRun = null;
  try { lastRun = await s.get("lastRun", { type: "json" }); } catch (_) {}

  const quota = await getQuota();
  return { watchlist: wl, histories, best, lastRun, quota };
}
