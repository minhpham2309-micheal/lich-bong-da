// Per-league page state — each calendar page keeps its own date/filter/sort,
// so switching tabs and coming back restores exactly where you left off.
import { DEFAULT_LEAGUE } from "./leagues-config.js";

const pages = new Map();
let currentLeagueId = DEFAULT_LEAGUE;
const listeners = new Set();

function freshPageState() {
  return {
    date: new Date(),       // selected day
    showAll: false,         // "Tất cả" mode: full upcoming window instead of one day
    stripOffset: 0,         // date-strip window shift (in days)
    teamFilter: null,       // { id, name, logo } -> schedule view
    query: "",              // live text filter
    sort: "time",           // time | live | timeDesc
  };
}

export function pageState(leagueId = currentLeagueId) {
  if (!pages.has(leagueId)) pages.set(leagueId, freshPageState());
  return pages.get(leagueId);
}

export function currentLeague() {
  return currentLeagueId;
}

export function setCurrentLeague(id) {
  currentLeagueId = id;
  emit();
}

export function update(patch) {
  Object.assign(pageState(), patch);
  emit();
}

export function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function emit() {
  for (const fn of listeners) fn();
}

export function sameDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

export function addDays(date, n) {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}
