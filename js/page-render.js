// Page orchestration: league tabs, hero, date strip, match list rendering
import { LEAGUES, leagueById, TEAM_RANGE_PAST_DAYS, TEAM_RANGE_FUTURE_DAYS } from "./leagues-config.js";
import { fetchScoreboard, ymd } from "./espn-api.js";
import { pageState, currentLeague, sameDay, addDays } from "./app-state.js";
import { matchCardHtml, skeletonHtml, emptyHtml, errorHtml, escapeHtml } from "./match-card-render.js";

const $ = (id) => document.getElementById(id);
const dowFmt = new Intl.DateTimeFormat("vi-VN", { weekday: "short" });
const dayFmt = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" });

let prevScores = new Map(); // eventId -> "home-away", to flash score changes
let loadSeq = 0;            // guards against out-of-order async renders

export function renderNav(liveCounts = new Map()) {
  $("league-nav").innerHTML = LEAGUES.map((l) => {
    const live = liveCounts.get(l.id) > 0 ? `<span class="tab-live"></span>` : "";
    return `<button class="league-tab ${l.id === currentLeague() ? "active" : ""}"
              data-league-id="${l.id}">${escapeHtml(l.tab)}${live}</button>`;
  }).join("");
}

export function renderHero(season, eventCount, liveCount) {
  const league = leagueById(currentLeague());
  const st = pageState();
  $("hero-title").textContent = league.name;
  const scope = st.teamFilter
    ? `lịch thi đấu của ${st.teamFilter.name}`
    : st.query
      ? `kết quả cho “${st.query}” trong ${TEAM_RANGE_PAST_DAYS} ngày qua → ${TEAM_RANGE_FUTURE_DAYS} ngày tới`
      : st.showAll
        ? `tất cả trận (${TEAM_RANGE_PAST_DAYS} ngày qua → ${TEAM_RANGE_FUTURE_DAYS} ngày tới)`
        : dayFmt.format(st.date);
  const parts = [season, scope, `${eventCount} trận`];
  if (liveCount > 0) parts.push(`${liveCount} đang LIVE`);
  $("hero-meta").textContent = parts.filter(Boolean).join("  ·  ");
}

export function renderDateStrip() {
  const st = pageState();
  const wrap = $("date-strip-wrap");
  wrap.style.display = st.teamFilter ? "none" : "flex"; // team view spans a range
  if (st.teamFilter) return;

  const today = new Date();
  const start = addDays(today, -3 + st.stripOffset);
  const pills = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(start, i);
    const cls = [
      "date-pill",
      !st.showAll && sameDay(d, st.date) && "selected",
      sameDay(d, today) && "is-today",
    ].filter(Boolean).join(" ");
    return `<button class="${cls}" data-date="${d.toISOString()}">
      <span class="dow">${dowFmt.format(d)}</span><span class="dom">${d.getDate()}</span>
    </button>`;
  });
  const allPill = `<button class="date-pill all-pill ${st.showAll ? "selected" : ""}" data-show-all>
    <span class="dow">xem</span><span class="dom-all">Tất cả</span>
  </button>`;
  $("date-strip").innerHTML = allPill + pills.join("");
  $("date-strip").querySelector(".selected")?.scrollIntoView({ inline: "center", block: "nearest" });
}

export function renderChip() {
  const st = pageState();
  $("chip-area").innerHTML = st.teamFilter
    ? `<span class="team-chip">
         ${st.teamFilter.logo ? `<img src="${escapeHtml(st.teamFilter.logo)}" alt="" />` : ""}
         ${escapeHtml(st.teamFilter.name)}
         <button class="remove-chip" id="remove-chip" title="Bỏ lọc đội">✕</button>
       </span>`
    : "";
}

function sortEvents(events, mode) {
  const liveRank = { in: 0, pre: 1, post: 2 };
  const arr = [...events];
  if (mode === "live") arr.sort((a, b) => liveRank[a.state] - liveRank[b.state] || a.date - b.date);
  else if (mode === "timeDesc") arr.sort((a, b) => b.date - a.date);
  else arr.sort((a, b) => a.date - b.date);
  return arr;
}

function applyFilters(events, st) {
  let out = events.filter((e) => e.home && e.away);
  if (st.teamFilter)
    out = out.filter((e) => e.home?.id === st.teamFilter.id || e.away?.id === st.teamFilter.id);
  if (st.query) {
    const q = st.query.toLowerCase();
    out = out.filter(
      (e) => e.home?.name.toLowerCase().includes(q) || e.away?.name.toLowerCase().includes(q),
    );
  }
  return out;
}

function flashChangedScores(container, events) {
  for (const ev of events) {
    if (ev.state === "pre") continue;
    const key = `${ev.home.score}-${ev.away.score}`;
    const prev = prevScores.get(ev.id);
    if (prev !== undefined && prev !== key) {
      container
        .querySelectorAll(`[data-event-id="${ev.id}"] .score`)
        .forEach((el) => el.classList.add("changed"));
    }
    prevScores.set(ev.id, key);
  }
}

function listHtml(events, st, grouped) {
  // multi-day views get date headers (unless live-first sort interleaves days)
  if (!grouped || st.sort === "live")
    return events.map((e) => matchCardHtml(e, st.query)).join("");
  let lastDay = "";
  return events.map((e) => {
    const day = dayFmt.format(e.date);
    const header = day !== lastDay ? `<h2 class="date-group-header">${escapeHtml(day)}</h2>` : "";
    lastDay = day;
    return header + matchCardHtml(e, st.query);
  }).join("");
}

// On an empty day, look ahead and offer a one-click jump to the next matchday
async function suggestNextMatchday(box, st, league, seq) {
  try {
    const range = `${ymd(addDays(st.date, 1))}-${ymd(addDays(st.date, 75))}`;
    const data = await fetchScoreboard(league.slug, range);
    if (seq !== loadSeq) return;
    const upcoming = data.events.filter((e) => e.home && e.away).sort((a, b) => a.date - b.date);
    if (!upcoming.length) return;
    const next = upcoming[0];
    const count = upcoming.filter((e) => sameDay(e.date, next.date)).length;
    box.querySelector(".empty-state")?.insertAdjacentHTML(
      "beforeend",
      `<button class="jump-next" data-jump-date="${next.date.toISOString()}">
         Ngày đấu kế tiếp: ${escapeHtml(dayFmt.format(next.date))} (${count} trận) →
       </button>`,
    );
  } catch { /* gợi ý là phụ — lỗi thì bỏ qua */ }
}

/** Main data path. Returns {liveCount} so callers can adapt poll cadence. */
export async function loadAndRenderMatches({ force = false, silent = false } = {}) {
  const st = pageState();
  const league = leagueById(currentLeague());
  const seq = ++loadSeq;
  const box = $("matches");
  if (!silent) box.innerHTML = skeletonHtml();

  // team filter, "Tất cả" mode, or free-text search all widen to the full window —
  // searching should never be trapped inside the selected day
  const rangeMode = !!(st.teamFilter || st.showAll || st.query);
  const dates = rangeMode
    ? `${ymd(addDays(new Date(), -TEAM_RANGE_PAST_DAYS))}-${ymd(addDays(new Date(), TEAM_RANGE_FUTURE_DAYS))}`
    : ymd(st.date);

  try {
    const data = await fetchScoreboard(league.slug, dates, { force });
    if (seq !== loadSeq) return { liveCount: 0 }; // a newer load superseded this one

    const filtered = sortEvents(applyFilters(data.events, st), st.sort);
    const liveCount = filtered.filter((e) => e.state === "in").length;
    // kickoff within 10 min (or feed not flipped to "in" yet) → poll at live cadence
    const imminent = filtered.some(
      (e) => e.state === "pre" && e.date - Date.now() < 10 * 60 * 1000 && Date.now() - e.date < 3 * 60 * 60 * 1000,
    );

    box.innerHTML = filtered.length
      ? listHtml(filtered, st, rangeMode)
      : emptyHtml(
          st.teamFilter
            ? "Đội này không có trận trong khoảng thời gian sắp tới."
            : st.query
              ? `Không trận nào khớp “${st.query}” trong ${TEAM_RANGE_PAST_DAYS} ngày qua → ${TEAM_RANGE_FUTURE_DAYS} ngày tới.`
              : st.showAll
                ? "Giải này chưa có lịch trong khoảng thời gian tới (có thể đang nghỉ giữa mùa)."
                : "Thử chọn ngày khác, hoặc bấm “Tất cả” để xem toàn bộ lịch.",
        );
    if (!filtered.length && !rangeMode)
      suggestNextMatchday(box, st, league, seq);
    flashChangedScores(box, filtered);
    renderHero(data.season, filtered.length, liveCount);
    return { liveCount, imminent };
  } catch (err) {
    if (seq !== loadSeq) return { liveCount: 0 };
    console.error("loadAndRenderMatches:", err);
    if (!silent) box.innerHTML = errorHtml();
    return { liveCount: 0, error: true };
  }
}
