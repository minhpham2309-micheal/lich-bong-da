// League registry — each entry is an independent calendar page (hash route #/{id})
export const LEAGUES = [
  { id: "wc",         slug: "fifa.world",     name: "World Cup 2026",   tab: "🏆 World Cup" },
  { id: "ucl",        slug: "uefa.champions", name: "Champions League", tab: "⭐ Champions League" },
  { id: "uel",        slug: "uefa.europa",    name: "Europa League",    tab: "🟠 Europa League" },
  { id: "epl",        slug: "eng.1",          name: "Premier League",   tab: "🦁 Premier League" },
  { id: "laliga",     slug: "esp.1",          name: "La Liga",          tab: "🇪🇸 La Liga" },
  { id: "seriea",     slug: "ita.1",          name: "Serie A",          tab: "🇮🇹 Serie A" },
  { id: "bundesliga", slug: "ger.1",          name: "Bundesliga",       tab: "🇩🇪 Bundesliga" },
  { id: "ligue1",     slug: "fra.1",          name: "Ligue 1",          tab: "🇫🇷 Ligue 1" },
];

export const DEFAULT_LEAGUE = "wc";

export function leagueById(id) {
  return LEAGUES.find((l) => l.id === id) || LEAGUES[0];
}

// Polling cadence (ms): faster when a live match is on screen.
// ESPN's CDN caches scoreboard for ~7s; live polls carry a cache-buster so
// every hit reaches origin — 7s keeps us aligned with their freshness floor.
export const POLL_IDLE_MS = 30_000;
export const POLL_LIVE_MS = 7_000;

// When a team filter is active we show its full schedule in this window
export const TEAM_RANGE_PAST_DAYS = 7;
export const TEAM_RANGE_FUTURE_DAYS = 45;
