// The endpoint the browser talks to. Actions via ?action=...
//   GET  ?action=state        -> { watchlist, histories, best, lastRun, quota }
//   POST ?action=refresh      -> run daily tracking now, then return state
//   POST ?action=best-dates   -> body { route, months } -> scan window, return cheapest
//   POST ?action=watchlist    -> body { routes:[{from,to,target_date,nights}] } -> save

import {
  getState,
  runDailyTracking,
  scanBestDates,
  setWatchlist,
} from "../lib/tracker.mjs";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "state";

  if (!process.env.SERPAPI_KEY) {
    return json({ error: "Server is missing SERPAPI_KEY." }, 500);
  }

  try {
    if (req.method === "GET" && action === "state") {
      return json(await getState());
    }
    if (req.method === "POST" && action === "refresh") {
      await runDailyTracking();
      return json(await getState());
    }
    if (req.method === "POST" && action === "best-dates") {
      const body = await req.json().catch(() => ({}));
      if (!body.route) return json({ error: "route is required" }, 400);
      return json(await scanBestDates(body.route, Number(body.months)));
    }
    if (req.method === "POST" && action === "watchlist") {
      const body = await req.json().catch(() => ({}));
      const watchlist = await setWatchlist(body.routes || []);
      return json({ watchlist });
    }
    return json({ error: "Unknown action: " + action }, 400);
  } catch (e) {
    return json({ error: String(e && e.message ? e.message : e) }, 500);
  }
};
