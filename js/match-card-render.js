// HTML builders for a single match card + list states (skeleton/empty/error)
import { logoHiDpi } from "./espn-api.js";

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]),
  );
}

// Length-preserving diacritic fold: each char maps to its base char, so indexes
// found on the folded string are valid on the original ("Atlético" ⇆ "atletico")
export function fold(s) {
  return [...String(s)].map((ch) => ch.normalize("NFD")[0]).join("").toLowerCase();
}

// Wrap the matched part of a name in <mark> for live-filter highlighting
export function highlight(name, query) {
  const safe = escapeHtml(name);
  if (!query) return safe;
  const idx = fold(name).indexOf(fold(query));
  if (idx < 0) return safe;
  return (
    escapeHtml(name.slice(0, idx)) +
    "<mark>" + escapeHtml(name.slice(idx, idx + query.length)) + "</mark>" +
    escapeHtml(name.slice(idx + query.length))
  );
}

const timeFmt = new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" });
export const kickoffText = (date) => timeFmt.format(date); // shared with the patch path

function formPips(form) {
  if (!form) return "";
  const label = { W: "Thắng", D: "Hòa", L: "Thua" };
  const pips = [...form].slice(-5).map((c) => {
    const cls = c === "W" ? "w" : c === "L" ? "l" : "d";
    return `<span class="form-pip ${cls}" title="${label[c] || c}"></span>`;
  });
  return `<span class="team-form" title="Phong độ 5 trận chính thức gần nhất — bấm vào đội để đối chiếu từng trận">${pips.join("")}</span>`;
}

// W/D/L of a finished match from the selected team's perspective —
// the proof behind the form pips
function resultChipHtml(ev, teamId) {
  if (ev.state !== "post" || !teamId) return "";
  const me = String(ev.home.id) === String(teamId) ? ev.home : ev.away;
  const opp = me === ev.home ? ev.away : ev.home;
  const [cls, label] = me.winner ? ["w", "Thắng"] : opp.winner ? ["l", "Thua"] : ["d", "Hòa"];
  return `<span class="result-chip ${cls}" title="${label}">${cls.toUpperCase()}</span>`;
}

function teamRow(team, opponent, state, query) {
  const result =
    state === "post" && team && opponent
      ? team.winner ? "winner" : opponent.winner ? "loser" : ""
      : "";
  return `
    <div class="team-row ${result}" data-team-id="${escapeHtml(team.id ?? "")}"
         data-team-name="${escapeHtml(team.name)}" data-team-logo="${escapeHtml(team.logo)}"
         role="button" tabindex="0" title="Bấm để xem lịch đội ${escapeHtml(team.name)}">
      ${team.logo ? `<img src="${escapeHtml(team.logo)}" srcset="${escapeHtml(team.logo)} 1x, ${escapeHtml(logoHiDpi(team.logo))} 2x" alt="" width="26" height="26" loading="lazy" decoding="async" />` : ""}
      <span class="team-name">${highlight(team.name, query)}</span>
      ${formPips(team.form)}
    </div>`;
}

export function statusPillHtml(ev) {
  if (ev.state === "in")
    return `<span class="status-pill live">${escapeHtml(ev.clock || "LIVE")}</span>`;
  if (ev.state === "post")
    return `<span class="status-pill ft">${escapeHtml(ev.statusDetail || "FT")}</span>`;
  return `<span class="status-pill">Sắp đá</span>`;
}

const pinIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 21s7-5.1 7-11a7 7 0 1 0-14 0c0 5.9 7 11 7 11Z"/><circle cx="12" cy="10" r="2.5"/></svg>`;
const tvIcon = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="6" width="18" height="13" rx="2"/><path d="m8 2 4 4 4-4"/></svg>`;

export function matchCardHtml(ev, query = "", perspectiveTeamId = null) {
  const started = ev.state !== "pre";
  const score = started
    ? `<div class="score-box">
         <span class="score" data-score-of="${escapeHtml(String(ev.home.id))}">${escapeHtml(ev.home.score)}</span>
         <span class="score" data-score-of="${escapeHtml(String(ev.away.id))}">${escapeHtml(ev.away.score)}</span>
       </div>`
    : `<div class="score-box upcoming"><span>–</span><span>–</span></div>`;

  // venue line: "Stadium, City, Country" — skip country when city already says it
  const place = [ev.venue, ev.city, ev.city.includes(ev.country) ? "" : ev.country]
    .filter(Boolean).join(", ");
  const meta = [
    ev.note && `<span class="meta-line group-note"><span class="meta-text">${escapeHtml(ev.note)}</span></span>`,
    `<span class="meta-line">${pinIcon}<span class="meta-text">${place ? escapeHtml(place) : "Sân: chưa công bố"}</span></span>`,
    ev.broadcasts.length &&
      `<span class="meta-line">${tvIcon}<span class="meta-text">${escapeHtml(ev.broadcasts.join(" · "))}</span></span>`,
  ].filter(Boolean).join("");

  return `
  <article class="match-card ${ev.state === "in" ? "is-live" : ""}"
           data-event-id="${escapeHtml(String(ev.id))}" data-state="${escapeHtml(ev.state)}">
    <div class="match-when">
      <span class="kickoff-time">${timeFmt.format(ev.date)}</span>
      ${statusPillHtml(ev)}
      ${resultChipHtml(ev, perspectiveTeamId)}
    </div>
    <div class="match-teams">
      ${teamRow(ev.home, ev.away, ev.state, query)}
      ${teamRow(ev.away, ev.home, ev.state, query)}
    </div>
    <div class="match-right">
      ${score}
      <div class="match-meta">${meta}</div>
    </div>
  </article>`;
}

export function skeletonHtml(n = 4) {
  return Array.from({ length: n }, () => `<div class="skeleton-card"></div>`).join("");
}

export function emptyHtml(message) {
  return `<div class="empty-state"><div class="big">Không có trận nào</div><p>${escapeHtml(message)}</p></div>`;
}

export function errorHtml() {
  return `<div class="error-state"><div class="big">Mất kết nối</div>
    <p>Không lấy được dữ liệu từ ESPN. Kiểm tra mạng rồi thử lại.</p>
    <button id="retry-btn">Thử lại</button></div>`;
}
