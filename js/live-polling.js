// Realtime layer: adaptive polling of the current page + cross-league live scan.
// Cadence speeds up to POLL_LIVE_MS whenever live matches are on screen,
// pauses entirely while the tab is hidden, refreshes instantly on return.
import { LEAGUES, POLL_IDLE_MS, POLL_LIVE_MS } from "./leagues-config.js";
import { fetchScoreboard, ymd } from "./espn-api.js";
import { loadAndRenderMatches, renderNav } from "./page-render.js";

let timer = null;
let currentDelay = POLL_IDLE_MS;
let onCadenceChange = () => {};

// Save-Data header or 2G connection → stay on the slow cadence, skip extras
function dataSaver() {
  const c = navigator.connection;
  return !!(c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || "")));
}

export function startPolling(cadenceCb) {
  onCadenceChange = cadenceCb || onCadenceChange;
  schedule(currentDelay);
  // first scan waits for idle so its 8 requests don't compete with first paint
  (window.requestIdleCallback || ((f) => setTimeout(f, 2500)))(() => scanAllLeaguesForLive());

  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else { tick(); }
  });
  // flaky network: halt while offline, refresh the moment we're back
  window.addEventListener("offline", stop);
  window.addEventListener("online", tick);
}

export function pollNow() {
  return tick();
}

function stop() {
  clearTimeout(timer);
  timer = null;
}

function schedule(delay) {
  stop();
  currentDelay = delay;
  onCadenceChange(delay);
  timer = setTimeout(tick, delay);
}

async function tick() {
  if (document.hidden) return;
  if (!navigator.onLine) return schedule(POLL_IDLE_MS); // retry heartbeat while offline
  const { liveCount, imminent, error } = await loadAndRenderMatches({ force: true, silent: true });
  if (!dataSaver()) scanAllLeaguesForLive(); // fire-and-forget: updates LIVE dots on tabs
  if (!error) {
    const stamp = new Date().toLocaleTimeString("vi-VN");
    document.getElementById("refresh-label").textContent = `↻ ${stamp}`;
  }
  const fast = (liveCount > 0 || imminent) && !dataSaver();
  schedule(fast ? POLL_LIVE_MS : POLL_IDLE_MS);
}

// Lightweight scan of today's fixtures in every league to badge the nav tabs
// and the topbar summary. Served mostly from cache (15s TTL on today).
let scanning = false;
let lastScanAt = 0;

// 8 requests per scan — pace by connection quality so fast networks get fresher badges
function scanInterval() {
  const c = navigator.connection;
  if (c && (c.saveData || /(^|-)2g$/.test(c.effectiveType || ""))) return 180_000;
  if (c && c.effectiveType === "3g") return 90_000;
  return 30_000;
}

async function scanAllLeaguesForLive() {
  if (scanning || Date.now() - lastScanAt < scanInterval()) return;
  scanning = true;
  lastScanAt = Date.now();
  try {
    const today = ymd(new Date());
    const results = await Promise.allSettled(
      LEAGUES.map((l) => fetchScoreboard(l.slug, today)),
    );
    const counts = new Map();
    let total = 0;
    results.forEach((r, i) => {
      const n = r.status === "fulfilled"
        ? r.value.events.filter((e) => e.state === "in").length
        : 0;
      counts.set(LEAGUES[i].id, n);
      total += n;
    });
    renderNav(counts);

    const summary = document.getElementById("live-summary");
    summary.hidden = total === 0;
    if (total > 0)
      document.getElementById("live-summary-text").textContent =
        `${total} trận đang diễn ra`;
  } finally {
    scanning = false;
  }
}
