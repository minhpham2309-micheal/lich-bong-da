// Slim status strip: tells the user when they're looking at saved data
// (offline / refresh failed) instead of silently showing stale scores.
const el = () => document.getElementById("net-banner");

export function showNetBanner(message) {
  const b = el();
  if (b.textContent === message && !b.hidden) return;
  b.textContent = message;
  b.hidden = false;
}

export function hideNetBanner() {
  el().hidden = true;
}
