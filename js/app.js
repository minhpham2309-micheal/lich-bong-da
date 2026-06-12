// Bootstrap: hash routing (#/wc, #/epl, …), event wiring, render cycle.
import { DEFAULT_LEAGUE, leagueById } from "./leagues-config.js";
import { pageState, currentLeague, setCurrentLeague, update, subscribe } from "./app-state.js";
import { renderNav, renderDateStrip, renderChip, loadAndRenderMatches } from "./page-render.js";
import * as search from "./team-search.js";
import { startPolling, pollNow } from "./live-polling.js";

const $ = (id) => document.getElementById(id);

function leagueFromHash() {
  const id = (location.hash.match(/^#\/(\w+)/) || [])[1];
  return leagueById(id || DEFAULT_LEAGUE).id;
}

function renderAll() {
  document.body.dataset.league = currentLeague();
  renderNav();
  renderDateStrip();
  renderChip();
  $("sort-select").value = pageState().sort;
  $("search-input").value = pageState().query;
  loadAndRenderMatches();
}

/* ── routing ── */
window.addEventListener("hashchange", () => {
  const id = leagueFromHash();
  if (id !== currentLeague()) {
    search.hideSuggestions();
    setCurrentLeague(id); // emits -> renderAll
  }
});

/* ── league tabs ── */
$("league-nav").addEventListener("click", (e) => {
  const tab = e.target.closest("[data-league-id]");
  if (tab) location.hash = `#/${tab.dataset.leagueId}`;
});

/* ── date strip ── */
$("all-btn").addEventListener("click", () => update({ showAll: !pageState().showAll }));
$("date-strip").addEventListener("click", (e) => {
  const pill = e.target.closest("[data-date]");
  if (pill) update({ date: new Date(pill.dataset.date), showAll: false });
});
$("strip-prev").addEventListener("click", () => update({ stripOffset: pageState().stripOffset - 7 }));
$("strip-next").addEventListener("click", () => update({ stripOffset: pageState().stripOffset + 7 }));
$("today-btn").addEventListener("click", () => update({ date: new Date(), stripOffset: 0, showAll: false }));

/* ── sort ── */
$("sort-select").addEventListener("change", (e) => update({ sort: e.target.value }));

/* ── search: suggestions + instant text filter ── */
let debounceId;
$("search-input").addEventListener("input", (e) => {
  const v = e.target.value;
  search.showSuggestions(v);
  search.syncQuery(v);
  clearTimeout(debounceId);
  debounceId = setTimeout(() => loadAndRenderMatches({ silent: true }), 220);
});

$("search-input").addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); search.moveFocus(1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); search.moveFocus(-1); }
  else if (e.key === "Enter" && search.isOpen()) { e.preventDefault(); search.pickFocused(); }
  else if (e.key === "Escape") search.hideSuggestions();
});

$("suggestions").addEventListener("click", (e) => {
  const item = e.target.closest("[data-idx]");
  if (item) search.pickByIndex(Number(item.dataset.idx));
});

document.addEventListener("click", (e) => {
  if (!$("search-wrap").contains(e.target)) search.hideSuggestions();
});

/* ── team-filter chip removal (chip is re-rendered, so delegate) ── */
$("chip-area").addEventListener("click", (e) => {
  if (e.target.closest("#remove-chip")) search.clearTeamFilter();
});

/* ── manual refresh + error retry ── */
$("refresh-btn").addEventListener("click", async () => {
  $("refresh-btn").classList.add("spinning");
  await pollNow();
  $("refresh-btn").classList.remove("spinning");
});
$("matches").addEventListener("click", (e) => {
  if (e.target.closest("#retry-btn")) loadAndRenderMatches({ force: true });
  const jump = e.target.closest("[data-jump-date]");
  if (jump) {
    const d = new Date(jump.dataset.jumpDate);
    const diffDays = Math.round((d - new Date()) / 86_400_000);
    update({ date: d, stripOffset: Math.max(0, diffDays - 3) }); // keep target visible on the strip
  }
});

/* ── go ── */
subscribe(renderAll);
setCurrentLeague(leagueFromHash());
startPolling((delayMs) => {
  $("poll-secs").textContent = Math.round(delayMs / 1000);
});
