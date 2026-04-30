function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatTime(ms) {
  const totalSeconds = Math.floor((Number(ms) || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let result = "";
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0 || result === "") result += `${seconds}s`;
  return result;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sigmoidNormalize(value, midpoint, steepness) {
  const v = Number.isFinite(value) ? value : 0;
  return 1 / (1 + Math.exp(-(v - midpoint) / steepness));
}

function valoStatScore(p) {
  const acs = sigmoidNormalize(p.avg_acs, 200, 65);
  const kast = clamp((Number(p.kast) || 0) / 100, 0, 1);
  const kad = sigmoidNormalize(Number(p.kad) || 0, 1.2, 0.28);
  const dd = sigmoidNormalize(Number(p.dd_delta) || 0, 0, 30);
  const win = Number(p.matches) > 0 ? clamp((Number(p.wins) || 0) / Number(p.matches), 0, 1) : 0;
  return clamp(Math.round((0.3 * acs + 0.2 * kast + 0.15 * kad + 0.25 * dd + 0.1 * win) * 1000), 10, 1000);
}

function getPlayerPayload() {
  const params = new URLSearchParams(window.location.search);
  const encoded = params.get("payload");
  if (encoded) {
    try {
      return JSON.parse(decodeURIComponent(encoded));
    } catch (error) {
      console.error("Unable to parse player payload from URL:", error);
    }
  }

  try {
    const stored = localStorage.getItem("valoStatPlayerPayload");
    if (stored) {
      return JSON.parse(stored);
    }
  } catch (error) {
    console.error("Unable to parse stored player payload:", error);
  }

  return null;
}

function getActLabel(payload) {
  if (!payload || !payload.currentActLabel) return "Player";
  return payload.currentActLabel;
}

function formatStat(value) {
  const numeric = Number(value);
  if (isNaN(numeric)) return "0.00";
  return numeric.toFixed(2);
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return escapeHtml(value.join(", "));
  }

  if (typeof value === "string" && Number.isNaN(Number(value))) {
    return escapeHtml(value);
  }

  return escapeHtml(formatStat(value));
}

function buildPlayerExtras(player) {
  const entries = [
    ["Kills Total", player.kills_total],
    ["ACS Total", player.acs_total],
    ["Deaths Total", player.deaths_total],
    ["Assists Total", player.assists_total],
    ["KAST Rounds Total", player.kast_rounds_total],
    ["Damage Delta Total", player.damage_delta_total],
    ["Rounds Total", player.rounds_total],
    ["Elo", player.elo],
    ["Season", player.season],
    ["Processed Matches", Array.isArray(player.processed_matches) ? player.processed_matches.length : player.processed_matches],
    ["Name", player.name],
  ];

  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `
      <div class="modal-extra-item">
        <span>${escapeHtml(label)}</span>
        <strong>${formatValue(value)}</strong>
      </div>
    `)
    .join("");
}

function stripPayloadFromUrl() {
  const params = new URLSearchParams(window.location.search);
  if (!params.has("payload")) return;
  params.delete("payload");
  const cleaned = params.toString();
  const nextUrl = cleaned ? `${window.location.pathname}?${cleaned}` : window.location.pathname;
  window.history.replaceState({}, document.title, nextUrl);
}

function renderPlayerPage(payload) {
  const root = document.getElementById("playerPageRoot");
  const player = payload?.player;

  if (!root) return;

  if (!player) {
    root.innerHTML = `
      <section class="player-page-empty">
        <h1>Player not found</h1>
        <p>No player data was passed to this page.</p>
        <a class="modal-link-btn" href="index.html">Back to ValoStat</a>
      </section>
    `;
    return;
  }

  const actLabel = getActLabel(payload);
  const winRateValue = Number(player.winrate) || 0;
  const wins = Number(player.wins) || 0;
  const losses = (Number(player.matches) || 0) - wins;
  const score = Math.round(valoStatScore(player));
  root.innerHTML = `
    <section class="player-page-topbar">
      <a class="modal-link-btn modal-page-btn" href="index.html">Back</a>
      <a class="modal-link-btn" target="_blank" rel="noopener noreferrer" href="https://tracker.gg/valorant/profile/riot/${encodeURIComponent(player.riot_id || player.id)}/overview">Tracker</a>
    </section>
    <section class="card-modal-content player-page-panel">
      <div class="card-modal-header">
        <h2 class="card-modal-title">${escapeHtml(player.id)} · ${escapeHtml(actLabel)}</h2>
        <div class="card-modal-actions">
          <span class="modal-score-sub">Standalone page</span>
        </div>
      </div>
      <div class="card-modal-body">
        <section class="modal-hero">
          <div class="modal-hero-art">
            <img src="${player.banner}" alt="${escapeHtml(player.id)} banner" />
          </div>
          <div class="modal-hero-copy">
            <div class="modal-hero-info">
              <div class="modal-hero-text">
                <p class="modal-kicker">Competitive Overview</p>
                <h3>${escapeHtml(player.rank)} · ${escapeHtml(player.level)} Level</h3>
                <p class="modal-identity">${escapeHtml(player.riot_id)}</p>
              </div>
              <div class="modal-ring" style="--win-percent: ${winRateValue};">
                <div class="modal-ring-text">
                  <span>${wins}W</span>
                  <span>${losses}L</span>
                </div>
              </div>
            </div>
          </div>
          <div class="modal-score-panel">
            <span class="modal-score-label">Tracker Score</span>
            <strong>${score}<small>/1000</small></strong>
            <span class="modal-score-sub">${escapeHtml(actLabel)}</span>
          </div>
        </section>

        <section class="modal-stats-grid">
          <article class="modal-stat-card">
            <span>Win %</span>
            <strong>${formatStat(player.winrate)}%</strong>
            <small>${player.wins}/${player.matches} matches</small>
          </article>
          <article class="modal-stat-card">
            <span>Avg ACS</span>
            <strong>${formatStat(player.avg_acs)}</strong>
            <small>Rounds: ${formatStat(player.acs_total)}</small>
          </article>
          <article class="modal-stat-card">
            <span>K/D</span>
            <strong>${formatStat(player.kd)}</strong>
            <small>KA/D: ${formatStat(player.kad)}</small>
          </article>
          <article class="modal-stat-card">
            <span>KAST</span>
            <strong>${formatStat(player.kast)}%</strong>
            <small>DDΔ/round: ${formatStat(player.dd_delta)}</small>
          </article>
        </section>

        <section class="modal-detail-grid">
          <div>
            <p><strong>Playtime</strong></p>
            <p>${formatTime(player.time_total)}</p>
          </div>
          <div>
            <p><strong>Acts Counted</strong></p>
            <p>${formatStat(player.actCount || 1)}</p>
          </div>
          <div>
            <p><strong>Acts Played</strong></p>
            <p>${player.actsPlayed ? escapeHtml(player.actsPlayed.toUpperCase()) : escapeHtml(actLabel.toUpperCase())}</p>
          </div>
          <div>
            <p><strong>Kills / Deaths / Assists</strong></p>
            <p>${formatStat(player.kills_total)} / ${formatStat(player.deaths_total)} / ${formatStat(player.assists_total)}</p>
          </div>
        </section>

        <section class="modal-implemented">
          <p><strong>To be implemented in it for now.</strong></p>
          <div class="modal-extra-grid">
            ${buildPlayerExtras(player)}
          </div>
        </section>
      </div>
    </section>
  `;
}

const payload = getPlayerPayload();
renderPlayerPage(payload);
stripPayloadFromUrl();