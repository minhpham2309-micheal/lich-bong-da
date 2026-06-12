// Team search: fuzzy suggestions with keyboard navigation.
// Picking a suggestion switches the page into "team schedule" mode.
import { leagueById } from "./leagues-config.js";
import { fetchTeams, logoHiDpi } from "./espn-api.js";
import { pageState, currentLeague, update } from "./app-state.js";
import { escapeHtml, highlight } from "./match-card-render.js";

const input = () => document.getElementById("search-input");
const dropdown = () => document.getElementById("suggestions");

let items = [];      // current suggestion list
let focusIdx = -1;

// prefix match > word-boundary > substring > abbreviation > fuzzy subsequence
function scoreTeam(team, q) {
  const name = team.name.toLowerCase();
  const abbr = team.abbr.toLowerCase();
  if (name.startsWith(q)) return 100;
  if (name.split(/\s+/).some((w) => w.startsWith(q))) return 80;
  if (name.includes(q)) return 60;
  if (abbr === q) return 55;
  if (abbr.startsWith(q)) return 40;
  let i = 0;
  for (const ch of name) if (ch === q[i]) i++;
  return i === q.length ? 10 : -1;
}

export async function showSuggestions(query) {
  const q = query.trim().toLowerCase();
  if (!q) return hideSuggestions();

  let teams;
  try {
    teams = await fetchTeams(leagueById(currentLeague()).slug);
  } catch {
    return hideSuggestions();
  }
  if (input().value.trim().toLowerCase() !== q) return; // stale response

  items = teams
    .map((t) => ({ team: t, score: scoreTeam(t, q) }))
    .filter((x) => x.score >= 0)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name))
    .slice(0, 8)
    .map((x) => x.team);

  focusIdx = -1;
  if (!items.length) return hideSuggestions();

  dropdown().innerHTML =
    items
      .map(
        (t, i) => `
      <button class="suggestion-item" data-idx="${i}">
        ${t.logo ? `<img src="${escapeHtml(t.logo)}" srcset="${escapeHtml(t.logo)} 1x, ${escapeHtml(logoHiDpi(t.logo))} 2x" alt="" width="22" height="22" loading="lazy" decoding="async" />` : ""}
        <span>${highlight(t.name, query.trim())}</span>
        <span class="abbr">${escapeHtml(t.abbr)}</span>
      </button>`,
      )
      .join("") +
    `<div class="suggestion-hint">↑↓ chọn · Enter xem lịch đội · Esc đóng · cứ gõ tiếp để tìm trên toàn bộ lịch</div>`;
  dropdown().hidden = false;
}

export function hideSuggestions() {
  dropdown().hidden = true;
  dropdown().innerHTML = "";
  items = [];
  focusIdx = -1;
}

export function moveFocus(delta) {
  if (!items.length) return;
  focusIdx = (focusIdx + delta + items.length) % items.length;
  dropdown().querySelectorAll(".suggestion-item").forEach((el, i) => {
    el.classList.toggle("focused", i === focusIdx);
    if (i === focusIdx) el.scrollIntoView({ block: "nearest" });
  });
}

export function pickFocused() {
  const team = items[focusIdx] ?? items[0];
  if (team) pickTeam(team);
  return !!team;
}

export function pickByIndex(i) {
  if (items[i]) pickTeam(items[i]);
}

function pickTeam(team) {
  input().value = "";
  hideSuggestions();
  update({ teamFilter: { id: team.id, name: team.name, logo: team.logo }, query: "" });
}

export function clearTeamFilter() {
  update({ teamFilter: null });
}

export function isOpen() {
  return !dropdown().hidden;
}

// keep state.query in sync for instant list filtering while typing
export function syncQuery(value) {
  pageState().query = value.trim();
}
