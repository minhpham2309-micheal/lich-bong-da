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

// TTL theo bản chất dữ liệu: ngày đã đá xong không bao giờ đổi,
// lịch tương lai hiếm khi đổi, chỉ hôm nay (live) mới cần tươi liên tục.
// ESPN buckets days by US Eastern: the ET-"yesterday" bucket can still hold a
// live match until ~11:00 VN, so only end < yesterday counts as immutable.
function ttlFor(dates) {
  const today = ymd(new Date());
  const y = new Date(); y.setDate(y.getDate() - 1);
  const [start, end = start] = dates.split("-");
  if (end < ymd(y)) return Infinity;     // safely finished buckets are immutable
  if (start > today) return 30 * 60_000; // future fixtures: 30 min
  return 15_000;                          // touches today/yesterday: keep fresh
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
 * Fetch fixtures for a league. `dates` = "YYYYMMDD" or "YYYYMMDD-YYYYMMDD"
 * (ESPN buckets these by US Eastern). Cache TTL: see ttlFor — 15s when the
 * range touches today/yesterday, 30min future, immutable past.
 */
export async function fetchScoreboard(slug, dates, { force = false, snapshot = true } = {}) {
  const key = `${slug}:${dates}`;
  const ttl = ttlFor(dates);
  const hit = scoreboardCache.get(key);
  if (!force && hit && Date.now() - hit.at < ttl) return hit.data;

  // force = live poll: unique _cb skips the CDN's ~7s cache so data is origin-fresh
  const buster = force ? `&_cb=${Date.now()}` : "";
  const raw = await getJson(`${BASE}/${slug}/scoreboard?dates=${dates}&limit=1000${buster}`);
  const label = COMP_LABELS[slug] || raw.leagues?.[0]?.name || "";
  const data = {
    season: raw.leagues?.[0]?.season?.displayName || "",
    leagueName: raw.leagues?.[0]?.name || "",
    events: (raw.events || []).map((e) => normalizeEvent(e, label)),
  };
  scoreboardCache.set(key, { at: Date.now(), data });
  capMap(scoreboardCache, 40);
  if (snapshot) saveSnapshot(key, data);
  return data;
}

// Maps grow per visited day/team — keep a session bound (delete oldest entries)
function capMap(map, max) {
  while (map.size > max) map.delete(map.keys().next().value);
}

/* ── localStorage snapshots: instant paint on revisit, network then patches ── */
const SNAP_PREFIX = "md:snap:";
const snapSavedAt = new Map(); // per-key write throttle
let pruned = false;            // prune is O(store) with JSON.parse — once per session

function pruneSnapshots() {
  for (let i = localStorage.length - 1; i >= 0; i--) {
    const k = localStorage.key(i);
    if (!k || !k.startsWith(SNAP_PREFIX)) continue;
    try {
      const s = JSON.parse(localStorage.getItem(k) || "{}");
      if (!s.at || Date.now() - s.at > 3 * 86_400_000) localStorage.removeItem(k);
    } catch {
      localStorage.removeItem(k); // a corrupt entry must not block pruning forever
    }
  }
}

function saveSnapshot(key, data) {
  try {
    // live polls hit this every 7s — serializing 100+ events each time is real
    // main-thread cost on phones, and the data barely changes: throttle per key
    if (Date.now() - (snapSavedAt.get(key) || 0) < 60_000) return;
    if (!pruned) { pruned = true; pruneSnapshots(); } // prune BEFORE writing: frees quota first
    localStorage.setItem(SNAP_PREFIX + key, JSON.stringify({ at: Date.now(), ...data }));
    snapSavedAt.set(key, Date.now());
  } catch { /* quota / private mode — snapshots are best-effort */ }
}

export function loadSnapshot(key, maxAgeMs = 12 * 60 * 60 * 1000) {
  try {
    const raw = localStorage.getItem(SNAP_PREFIX + key);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (Date.now() - s.at > maxAgeMs) return null;
    // revive Date objects; drop corrupt entries so Intl.format can't throw later
    s.events = (s.events || []).filter((e) => {
      e.date = new Date(e.date);
      return !isNaN(+e.date);
    });
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
  // snapshot:false — a ±120-day payload is never re-read as a snapshot, only mined for names
  const { events } = await fetchScoreboard(slug, `${ymd(from)}-${ymd(to)}`, { snapshot: false });
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

/* ── Team season schedule: real past results so the form is verifiable ── */
const scheduleCache = new Map(); // slug:teamId -> { at, data }

// national teams play across many competitions — pull them all so a World Cup
// team's past matches (friendlies, qualifiers, continental cups) are visible
const NATIONAL_COMPS = [
  "fifa.friendly",
  "fifa.worldq.uefa", "fifa.worldq.conmebol", "fifa.worldq.concacaf",
  "fifa.worldq.afc", "fifa.worldq.caf", "fifa.worldq.ofc",
  "uefa.nations", "concacaf.nations.league", "concacaf.gold", "caf.nations",
];

// short display labels per competition — events in a mixed list carry these
// so a team's history says WHICH tournament each match belonged to
const COMP_LABELS = {
  "fifa.world": "World Cup",
  "fifa.friendly": "Giao hữu",
  "fifa.worldq.uefa": "VL World Cup · UEFA",
  "fifa.worldq.conmebol": "VL World Cup · Nam Mỹ",
  "fifa.worldq.concacaf": "VL World Cup · CONCACAF",
  "fifa.worldq.afc": "VL World Cup · châu Á",
  "fifa.worldq.caf": "VL World Cup · châu Phi",
  "fifa.worldq.ofc": "VL World Cup · châu Đại Dương",
  "uefa.nations": "UEFA Nations League",
  "concacaf.nations.league": "CONCACAF Nations League",
  "concacaf.gold": "Gold Cup",
  "caf.nations": "AFCON",
};

export async function fetchTeamSchedule(slug, teamId) {
  const key = `${slug}:${teamId}`;
  const hit = scheduleCache.get(key);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.data;

  const feeds = [
    { url: `${BASE}/${slug}/teams/${teamId}/schedule`, slug },
    { url: `${BASE}/${slug}/teams/${teamId}/schedule?fixture=true`, slug },
    ...(slug === "fifa.world"
      ? NATIONAL_COMPS.map((c) => ({ url: `${BASE}/${c}/teams/${teamId}/schedule`, slug: c }))
      : []),
  ];
  const results = await Promise.allSettled(feeds.map((f) => getJson(f.url)));
  // a missing competition is fine; ALL feeds failing is a network error and
  // must throw — silently returning [] would overwrite good snapshot content
  if (!results.some((r) => r.status === "fulfilled")) throw results[0].reason;
  let season = "";
  const byId = new Map();
  results.forEach((r, i) => {
    if (r.status !== "fulfilled") return; // a missing competition is fine
    season ||= r.value.season?.displayName || "";
    const label = COMP_LABELS[feeds[i].slug] || "";
    for (const raw of r.value.events || []) {
      const e = normalizeScheduleEvent(raw, label);
      if (e && !byId.has(e.id)) byId.set(e.id, e);
    }
  });
  const data = { season, events: [...byId.values()] };
  scheduleCache.set(key, { at: Date.now(), data });
  capMap(scheduleCache, 20);
  saveSnapshot(`${slug}:team:${teamId}`, data); // team view works offline too
  return data;
}

// shared event shape — sources differ between scoreboard and schedule feeds,
// so status/clock/broadcasts/competitors are resolved by the caller
function eventShape(e, comp, st, clock, broadcasts, home, away, league) {
  return {
    id: String(e.id), // ids are compared all over the app — normalize once here
    league: league || "", // which competition this match belongs to
    date: new Date(e.date),
    state: st.state || "pre", // pre | in | post
    statusDetail: st.shortDetail || "",
    completed: !!st.completed,
    clock: clock || "",
    venue: comp.venue?.fullName || "",
    city: comp.venue?.address?.city || "",
    country: comp.venue?.address?.country || "",
    note: comp.notes?.[0]?.headline || "",
    broadcasts,
    home,
    away,
  };
}

function competitorShape(c, { logo, score, form }) {
  return {
    id: c.team?.id != null ? String(c.team.id) : "",
    homeAway: c.homeAway,
    name: c.team?.displayName || "?",
    shortName: c.team?.shortDisplayName || c.team?.displayName || "?",
    abbr: c.team?.abbreviation || "",
    logo: smallLogo(logo),
    score,
    winner: c.winner === true,
    form,
  };
}

// schedule events: score is an object, status sits on the competition,
// logos only under team.logos, no form field
function normalizeScheduleEvent(e, leagueLabel = "") {
  const comp = e.competitions?.[0] || {};
  const map = (c) =>
    c &&
    competitorShape(c, {
      logo: c.team?.logos?.[0]?.href || "",
      score: c.score?.displayValue ?? "",
      form: "",
    });
  const home = map((comp.competitors || []).find((c) => c.homeAway === "home"));
  const away = map((comp.competitors || []).find((c) => c.homeAway === "away"));
  if (!home || !away) return null;
  const broadcasts = (comp.broadcasts || [])
    .map((b) => b.media?.shortName || (b.names || [])[0])
    .filter(Boolean)
    .slice(0, 3);
  return eventShape(
    e, comp, comp.status?.type || {}, comp.status?.displayClock, broadcasts, home, away,
    leagueLabel || e.league?.name || "",
  );
}

function normalizeCompetitor(c) {
  return competitorShape(c, {
    logo: c.team?.logo || c.team?.logos?.[0]?.href || "",
    score: c.score ?? "",
    // ESPN's form string is most-recent-FIRST; reverse it so every form in the
    // app reads chronologically (left = oldest, right = latest match)
    form: c.form ? [...c.form].reverse().join("") : "",
  });
}

function normalizeEvent(e, leagueLabel = "") {
  const comp = e.competitions?.[0] || {};
  const home = (comp.competitors || []).find((c) => c.homeAway === "home");
  const away = (comp.competitors || []).find((c) => c.homeAway === "away");
  const broadcasts = (comp.broadcasts || []).flatMap((b) => b.names || []).slice(0, 3);
  return eventShape(
    e, comp, e.status?.type || {}, e.status?.displayClock, broadcasts,
    home ? normalizeCompetitor(home) : null,
    away ? normalizeCompetitor(away) : null,
    leagueLabel,
  );
}
