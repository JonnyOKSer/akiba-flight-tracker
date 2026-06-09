// Runs once a day on Netlify's schedule. One SerpApi search per watched route.
import { runDailyTracking } from "../lib/tracker.mjs";

export default async () => {
  const results = await runDailyTracking();
  return new Response(JSON.stringify({ ok: true, results }), {
    headers: { "Content-Type": "application/json" },
  });
};

// Daily at 09:00 UTC. Adjust the cron string to taste (https://crontab.guru).
export const config = { schedule: "0 9 * * *" };
