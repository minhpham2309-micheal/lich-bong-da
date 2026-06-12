// Page orchestration: league tabs, hero, date strip, match list rendering
import { LEAGUES, leagueById, RANGE_PAST_DAYS, RANGE_FUTURE_DAYS } from "./leagues-config.js";
import { fetchScoreboard, fetchTeamSchedule, loadSnapshot, logoHiDpi, ymd } from "./espn-api.js";
import { pageState, currentLeague, sameDay, addDays } from "./app-state.js";
import { matchCardHtml, statusPillHtml, kickoffText, fold, skeletonHtml, emptyHtml, errorHtml, escapeHtml } from "./match-card-render.js";
import { showNetBanner, hideNetBanner } from "./net-banner.js";

const $ = (id) => document.getElementById(id);
const dowFmt = new Intl.DateTimeFormat("vi-VN", { weekday: "short" });
const dayFmt = new Intl.DateTimeFormat("vi-VN", { weekday: "long", day: "numeric", month: "long" });

let prevScores = new Map(); // eventId -> "home-away", to flash score changes
let loadSeq = 0;            // guards against out-of-order async renders
let lastRenderSig = "";     // skip DOM rebuilds when a silent poll brings no changes
let lastViewKey = "";       // entrance animation only when the view truly changes

let lastLiveCounts = new Map(); // remembered so re-renders don't wipe the LIVE dots

export function renderNav(liveCounts) {
  if (liveCounts) lastLiveCounts = liveCounts;
  $("league-nav").innerHTML = LEAGUES.map((l) => {
    const live = lastLiveCounts.get(l.id) > 0 ? `<span class="tab-live"></span>` : "";
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
      ? `kết quả cho “${st.query}” trong ${RANGE_PAST_DAYS} ngày qua → ${RANGE_FUTURE_DAYS} ngày tới`
      : st.showAll
        ? `tất cả trận (${RANGE_PAST_DAYS} ngày qua → ${RANGE_FUTURE_DAYS} ngày tới)`
        : dayFmt.format(st.date);
  const parts = [season, scope, `${eventCount} trận`];
  if (liveCount > 0) parts.push(`${liveCount} đang LIVE`);
  $("hero-meta").textContent = parts.filter(Boolean).join("  ·  ");
}

export function renderDateStrip() {
  const st = pageState();
  const wrap = $("date-strip-wrap");
  // hide in team-schedule view; empty string defers to the stylesheet (flex/grid per breakpoint)
  wrap.style.display = st.teamFilter ? "none" : "";
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
    const isSel = !st.showAll && sameDay(d, st.date);
    return `<button class="${cls}" data-date="${d.toISOString()}" ${isSel ? 'aria-current="date"' : ""}>
      <span class="dow">${dowFmt.format(d)}</span><span class="dom">${d.getDate()}</span>
    </button>`;
  });
  $("all-btn").classList.toggle("active", st.showAll);
  $("date-strip").innerHTML = pills.join("");
  $("date-strip").querySelector(".selected")?.scrollIntoView({ inline: "center", block: "nearest" });
}

export function renderChip() {
  const st = pageState();
  $("chip-area").innerHTML = st.teamFilter
    ? `<span class="team-chip">
         ${st.teamFilter.logo ? `<img src="${escapeHtml(st.teamFilter.logo)}" srcset="${escapeHtml(st.teamFilter.logo)} 1x, ${escapeHtml(logoHiDpi(st.teamFilter.logo))} 2x" alt="" width="18" height="18" decoding="async" />` : ""}
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

function applyFilters(events, st, dayOnly = null) {
  let out = events.filter((e) => e.home && e.away);
  // ESPN buckets days by US Eastern — we fetch ±1 day and cut to the local day here
  if (dayOnly) out = out.filter((e) => sameDay(e.date, dayOnly));
  if (st.teamFilter)
    out = out.filter((e) => e.home?.id === st.teamFilter.id || e.away?.id === st.teamFilter.id);
  if (st.query) {
    const q = fold(st.query);
    out = out.filter(
      (e) => fold(e.home?.name || "").includes(q) || fold(e.away?.name || "").includes(q),
    );
  }
  return out;
}

/**
 * Keyed in-place patch: when the visible list has the same matches in the same
 * order, update only status pills + changed score nodes instead of rebuilding.
 * Returns false on any structural difference (new match, reorder, pre→started)
 * so the caller falls back to a full render.
 */
function tryPatchCards(box, events, st) {
  const cards = box.querySelectorAll(".match-card");
  // empty list never "patches" — vacuous match would leave skeleton/stale UI up;
  // membership/order changes need the full list render
  if (!events.length || cards.length !== events.length) return false;
  for (let i = 0; i < events.length; i++)
    if (cards[i].dataset.eventId !== String(events[i].id)) return false;

  events.forEach((ev, i) => {
    if (cards[i].dataset.state !== ev.state) {
      // state transition (pre→in, in→post) changes structure/styling — rebuild
      // JUST this card; neighbours that are still live keep their DOM untouched
      cards[i].outerHTML = matchCardHtml(ev, st.query, st.teamFilter?.id);
      if (ev.state !== "pre") prevScores.set(ev.id, `${ev.home.score}-${ev.away.score}`);
    } else {
      patchCard(cards[i], ev);
    }
  });
  return true;
}

// announce the latest score change to screen readers without re-reading the list
function announceScore(ev) {
  const el = $("sr-status");
  if (el) el.textContent = `${ev.home.name} ${ev.home.score} - ${ev.away.score} ${ev.away.name}`;
}

function patchCard(card, ev) {
  card.classList.toggle("is-live", ev.state === "in");
  const pill = card.querySelector(".status-pill");
  if (pill && pill.outerHTML !== statusPillHtml(ev)) pill.outerHTML = statusPillHtml(ev);
  const ko = card.querySelector(".kickoff-time");
  if (ko && ko.textContent !== kickoffText(ev.date)) ko.textContent = kickoffText(ev.date);
  if (ev.state === "pre") return;
  for (const team of [ev.home, ev.away]) {
    const el = card.querySelector(`.score[data-score-of="${CSS.escape(String(team.id))}"]`);
    if (el && el.textContent !== String(team.score)) {
      el.textContent = team.score;
      el.classList.remove("changed");
      void el.offsetWidth; // restart the flash animation
      el.classList.add("changed");
      announceScore(ev);
    }
  }
  prevScores.set(ev.id, `${ev.home.score}-${ev.away.score}`);
}

function flashChangedScores(container, events) {
  if (prevScores.size > 500) prevScores.clear(); // session bound — flash resets are harmless
  for (const ev of events) {
    if (ev.state === "pre") continue;
    const key = `${ev.home.score}-${ev.away.score}`;
    const prev = prevScores.get(ev.id);
    if (prev !== undefined && prev !== key) {
      container
        .querySelectorAll(`[data-event-id="${CSS.escape(String(ev.id))}"] .score`)
        .forEach((el) => el.classList.add("changed"));
      announceScore(ev);
    }
    prevScores.set(ev.id, key);
  }
}

function listHtml(events, st, grouped) {
  const pid = st.teamFilter?.id; // W/D/L chips from the selected team's view
  // multi-day views get date headers (unless live-first sort interleaves days)
  if (!grouped || st.sort === "live")
    return events.map((e) => matchCardHtml(e, st.query, pid)).join("");
  let lastDay = "";
  return events.map((e) => {
    const day = dayFmt.format(e.date);
    const header = day !== lastDay ? `<h2 class="date-group-header">${escapeHtml(day)}</h2>` : "";
    lastDay = day;
    return header + matchCardHtml(e, st.query, pid);
  }).join("");
}

// On an empty day, look ahead and offer a one-click jump to the next matchday
async function suggestNextMatchday(box, st, league, seq) {
  try {
    // start at the selected ET bucket: a "tomorrow VN" match can live in it
    const range = `${ymd(st.date)}-${ymd(addDays(st.date, 75))}`;
    const data = await fetchScoreboard(league.slug, range);
    if (seq !== loadSeq) return;
    const dayEnd = new Date(st.date);
    dayEnd.setHours(23, 59, 59, 999);
    const upcoming = data.events
      .filter((e) => e.home && e.away && e.date > dayEnd) // strictly after the selected local day
      .sort((a, b) => a.date - b.date);
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
  // skeleton only if the fetch is actually slow — cached loads render directly,
  // so quick interactions don't flash a loading state that reads as lag
  let settled = false;
  if (!silent)
    setTimeout(() => {
      if (!settled && seq === loadSeq) box.innerHTML = skeletonHtml();
    }, 180);

  // team filter, "Tất cả" mode, or free-text search all widen to the full window —
  // searching should never be trapped inside the selected day
  const rangeMode = !!(st.teamFilter || st.showAll || st.query);
  // ESPN buckets "dates=" by US Eastern; a local (UTC+7) day straddles two
  // buckets, so day view fetches ±1 day and applyFilters cuts to the local day
  const dayOnly = rangeMode ? null : st.date;
  const dates = st.teamFilter
    ? `team:${st.teamFilter.id}` // label for sig/viewKey — fetch uses the schedule endpoint
    : rangeMode
      ? `${ymd(addDays(new Date(), -RANGE_PAST_DAYS))}-${ymd(addDays(new Date(), RANGE_FUTURE_DAYS))}`
      : `${ymd(addDays(st.date, -1))}-${ymd(addDays(st.date, 1))}`;

  // instant paint from the local snapshot while the network round-trip runs;
  // the fresh response then re-renders (or patches) over it. Fires when the
  // box is empty OR we're entering a different view (league/day/team switch)
  const viewKey = JSON.stringify([league.id, dates, st.teamFilter?.id]);
  if (!silent && (viewKey !== lastViewKey || !box.querySelector(".match-card"))) {
    try {
      const snap = loadSnapshot(`${league.slug}:${dates}`);
      if (snap) {
        const cached = sortEvents(applyFilters(snap.events, st, dayOnly), st.sort);
        if (cached.length) {
          settled = true; // real content on screen — no skeleton needed
          box.classList.add("view-enter");
          box.innerHTML = listHtml(cached, st, rangeMode);
          renderHero(snap.season, cached.length, cached.filter((e) => e.state === "in").length);
        }
      }
    } catch { /* snapshot paint is best-effort — the network render follows */ }
  }

  if (!silent) $("refresh-btn").classList.add("spinning"); // background fetch cue
  try {
    let data;
    if (st.teamFilter) {
      // team view: full season from the schedule endpoint (real, verifiable
      // results) + today's scoreboard merged in for live scores
      // live window = ET yesterday-today: during VN mornings the live match
      // sits in ESPN's "yesterday" bucket
      const liveWin = `${ymd(addDays(new Date(), -1))}-${ymd(new Date())}`;
      const [sched, today] = await Promise.all([
        fetchTeamSchedule(league.slug, st.teamFilter.id),
        fetchScoreboard(league.slug, liveWin, { force }),
      ]);
      const tid = String(st.teamFilter.id);
      const byId = new Map(sched.events.map((e) => [e.id, e]));
      for (const e of today.events)
        if (e.home?.id === st.teamFilter.id || e.away?.id === st.teamFilter.id) byId.set(e.id, e);
      const all = [...byId.values()];

      // form pips computed from the very matches on this screen — verifiable
      // 1:1 against the W/D/L chips, independent of ESPN's own form field
      const formStr = all
        .filter((e) => e.state === "post")
        .sort((a, b) => a.date - b.date)
        .slice(-5)
        .map((e) => {
          const me = String(e.home.id) === tid ? e.home : e.away;
          const opp = me === e.home ? e.away : e.home;
          return me.winner ? "W" : opp.winner ? "L" : "D";
        })
        .join("");
      const events = all.map((e) => {
        const side = String(e.home.id) === tid ? "home" : String(e.away.id) === tid ? "away" : null;
        return side ? { ...e, [side]: { ...e[side], form: formStr } } : e; // clone — caches stay pristine
      });
      data = { season: sched.season || today.season, events };
    } else {
      data = await fetchScoreboard(league.slug, dates, { force });
    }
    if (seq !== loadSeq) return { liveCount: 0 }; // a newer load superseded this one
    settled = true;
    hideNetBanner(); // fresh data landed — any stale-data warning is obsolete

    const filtered = sortEvents(applyFilters(data.events, st, dayOnly), st.sort);
    const liveCount = filtered.filter((e) => e.state === "in").length;
    // kickoff within 10 min (or feed not flipped to "in" yet) → poll at live cadence
    const imminent = filtered.some(
      (e) => e.state === "pre" && e.date - Date.now() < 10 * 60 * 1000 && Date.now() - e.date < 3 * 60 * 60 * 1000,
    );

    // weak-device guard: identical view + identical data → leave the DOM alone
    const sig = JSON.stringify([
      league.id, dates, st.sort, st.query, st.teamFilter?.id,
      filtered.map((e) => [e.id, +e.date, e.state, e.home.score, e.away.score, e.clock, e.statusDetail]),
    ]);
    if (silent && sig === lastRenderSig) return { liveCount, imminent };
    lastRenderSig = sig;

    // entrance animation on real view changes (league/day/team) only;
    // sort tweaks, typing, and live score updates swap content in place
    const isNewView = viewKey !== lastViewKey;
    lastViewKey = viewKey;

    // data changed but the list shape didn't → surgical patch, no rebuild
    if (tryPatchCards(box, filtered, st)) {
      renderHero(data.season, filtered.length, liveCount);
      return { liveCount, imminent };
    }
    box.classList.toggle("view-enter", isNewView);

    box.innerHTML = filtered.length
      ? listHtml(filtered, st, rangeMode)
      : emptyHtml(
          st.teamFilter
            ? "Đội này không có trận trong khoảng thời gian sắp tới."
            : st.query
              ? `Không trận nào khớp “${st.query}” trong ${RANGE_PAST_DAYS} ngày qua → ${RANGE_FUTURE_DAYS} ngày tới.`
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
    settled = true;
    console.error("loadAndRenderMatches:", err);
    // never wipe good content (cards or a valid empty-state) with an error
    // screen — but always tell the user the data on screen may be stale
    if (!silent && !box.querySelector(".match-card")) box.innerHTML = errorHtml();
    else showNetBanner("Không lấy được dữ liệu mới — đang hiển thị bản đã lưu, sẽ tự thử lại.");
    return { liveCount: 0, error: true };
  } finally {
    if (!silent && seq === loadSeq) $("refresh-btn").classList.remove("spinning");
  }
}
