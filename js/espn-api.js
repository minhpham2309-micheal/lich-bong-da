// ESPN public soccer API client — no key required, CORS-enabled.
const BASE = "https://site.api.espn.com/apis/site/v2/sports/soccer";

const scoreboardCache = new Map(); // key -> { at, data }
const teamsCache = new Map();      // slug -> teams[]

export function ymd(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function isTodayKey(dates) {
  return dates.includes(ymd(new Date()));
}

async function getJson(url) {
  // timeout so a hung request on flaky networks can't stall the polling loop
  const res = await fetch(url, {
    headers: { Accept: "application/json" },
    signal: AbortSignal.timeout(12_000),
  });
  if (!res.ok) throw new Error(`ESPN ${res.status}`);
  return res.json();
}

// ESPN serves 500×500 logos; the combiner resizes server-side (~12KB → ~1KB each)
function smallLogo(url) {
  const m = (url || "").match(/^https:\/\/a\.espncdn\.com(\/i\/.+)$/);
  return m ? `https://a.espncdn.com/combiner/i?img=${encodeURI(m[1])}&w=64&h=64` : url || "";
}

// 2.2KB 128px variant for retina screens — browsers pick via srcset by pixel density
export function logoHiDpi(url) {
  return url.includes("/combiner/") ? url.replace("w=64&h=64", "w=128&h=128") : url;
}

/**
 * Fetch fixtures for a league. `dates` = "YYYYMMDD" or "YYYYMMDD-YYYYMMDD".
 * Cache TTL: 15s if range touches today (live data), 5min otherwise.
 */
export async function fetchScoreboard(slug, dates, { force = false } = {}) {
  const key = `${slug}:${dates}`;
  const ttl = isTodayKey(dates) ? 15_000 : 300_000;
  const hit = scoreboardCache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.data;

  // force = live poll: unique _cb skips the CDN's ~7s cache so data is origin-fresh
  const buster = force ? `&_cb=${Date.now()}` : "";
  const raw = await getJson(`${BASE}/${slug}/scoreboard?dates=${dates}&limit=1000${buster}`);
  const data = {
    season: raw.leagues?.[0]?.season?.displayName || "",
    leagueName: raw.leagues?.[0]?.name || "",
    events: (raw.events || []).map(normalizeEvent),
  };
  scoreboardCache.set(key, { at: Date.now(), data });
  saveSnapshot(key, data);
  return data;
}

/* ── localStorage snapshots: instant paint on revisit, network then patches ── */
const SNAP_PREFIX = "md:snap:";

function saveSnapshot(key, data) {
  try {
    localStorage.setItem(SNAP_PREFIX + key, JSON.stringify({ at: Date.now(), ...data }));
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(SNAP_PREFIX)) continue;
      const s = JSON.parse(localStorage.getItem(k) || "{}");
      if (!s.at || Date.now() - s.at > 3 * 86_400_000) localStorage.removeItem(k);
    }
  } catch { /* quota / private mode — snapshots are best-effort */ }
}

export function loadSnapshot(key, maxAgeMs = 12 * 60 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(SNAP_PREFIX + key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.at > maxAgeMs) return null;
    s.events.forEach((e) => (e.date = new Date(e.date))); // revive Date objects
    return s;
  } catch {
    return null;
  }
}

/**
 * Team list for search suggestions. ESPN's /teams endpoint has no CORS header,
 * so we derive the roster from a wide scoreboard window (which is CORS-enabled):
 * ±120 days covers a full World Cup and the bulk of any club season.
 */
export async function fetchTeams(slug) {
  if (teamsCache.has(slug)) return teamsCache.get(slug);
  const now = new Date();
  const from = new Date(now); from.setDate(from.getDate() - 120);
  const to = new Date(now); to.setDate(to.getDate() + 120);
  const { events } = await fetchScoreboard(slug, `${ymd(from)}-${ymd(to)}`);
  // knockout-bracket placeholders ("Third Place Group A/B", "Winner Match 74"…) are not real teams
  const placeholder = /^(third place|winner|runner|loser|tbd|to be det)/i;
  const byId = new Map();
  for (const ev of events) {
    for (const t of [ev.home, ev.away]) {
      if (t && !byId.has(t.id) && t.id && !placeholder.test(t.name))
        byId.set(t.id, { id: t.id, name: t.name, shortName: t.shortName, abbr: t.abbr, logo: t.logo });
    }
  }
  const teams = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  teamsCache.set(slug, teams);
  return teams;
}

function normalizeCompetitor(c) {
  return {
    id: c.team?.id,
    homeAway: c.homeAway,
    name: c.team?.displayName || "?",
    shortName: c.team?.shortDisplayName || c.team?.displayName || "?",
    abbr: c.team?.abbreviation || "",
    logo: smallLogo(c.team?.logo || c.team?.logos?.[0]?.href || ""),
    score: c.score ?? "",
    winner: c.winner === true,
    form: c.form || "",
  };
}

function normalizeEvent(e) {
  const comp = e.competitions?.[0] || {};
  const home = (comp.competitors || []).find((c) => c.homeAway === "home");
  const away = (comp.competitors || []).find((c) => c.homeAway === "away");
  const st = e.status?.type || {};
  return {
    id: e.id,
    date: new Date(e.date),
    state: st.state || "pre", // pre | in | post
    statusDetail: st.shortDetail || "",
    completed: !!st.completed,
    clock: e.status?.displayClock || "",
    venue: comp.venue?.fullName || "",
    city: comp.venue?.address?.city || "",
    country: comp.venue?.address?.country || "",
    note: comp.notes?.[0]?.headline || "",
    broadcasts: (comp.broadcasts || []).flatMap((b) => b.names || []).slice(0, 3),
    home: home ? normalizeCompetitor(home) : null,
    away: away ? normalizeCompetitor(away) : null,
  };
}
