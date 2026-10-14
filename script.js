const navButtons = document.querySelectorAll(".nav-btn");
const profiles = document.getElementById("profiles");
const selectA = document.getElementById("playerA");
const selectB = document.getElementById("playerB");
const compareBtn = document.getElementById("compareBtn");
const comparison = document.getElementById("comparison");
const defaultAct = "v26-a6";

let players = [];
let cache = {};
let overallCache = null;
let currentActData = null;
let prev = null;
let showDiff = false;
let currentAct = defaultAct;

let actMap = {
  "overall": "overall",
  "v26-a6": "e11a6",
  "v26-a5": "e11a5",
  "v26-a4": "e11a4",
  "v26-a3": "e11a3",
  "v26-a2": "e11a2",
};

function isDefaultActCode(act) {
  return act === defaultAct || act === "e11a6";
}

function trackerProfileUrl(riotId) {
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(riotId)}/overview`;
}

function getActLabel(actCode) {
  if (actCode === "overall") return "Overall";
  if (actCode === "e11a6" || actCode === defaultAct) return "V26: A6";
  if (actCode === "e11a5") return "V26: A5";
  if (actCode === "e11a4") return "V26: A4";
  if (actCode === "e11a3") return "V26: A3";
  if (actCode === "e11a2") return "V26: A2";
  return String(actCode || "Player").toUpperCase();
}

function formatStat(value) {
  if (value === null || value === undefined || value === "") return "N/A";

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  if (Number.isInteger(numeric)) return String(numeric);

  return numeric.toFixed(2);
}

function buildPlayerExtras(player) {
  const entries = [
    ["Kills Total", player.kills_total],
    ["Deaths Total", player.deaths_total],
    ["Assists Total", player.assists_total],
    ["KAST Rounds Total", player.kast_rounds_total],
    ["ACS Total", player.acs_total],
    ["Damage Delta Total", player.damage_delta_total],
  ];

  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `
      <div class="modal-extra-item">
        <span>${escapeHtml(label)}</span>
        <strong>${value}</strong>
        ${
          ["Kills Total", "Deaths Total", "Assists Total"].includes(label)
            ? `<small>(${formatStat(value / (Number(player.matches) || 1))} per match)</small>`
            : ""
        }
      </div>
    `)
    .join("");
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function ensureCardModal() {
  let modal = document.getElementById("cardModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "cardModal";
  modal.className = "card-modal";

  modal.innerHTML = `
    <div class="card-modal-content" role="dialog" aria-modal="true" aria-labelledby="cardModalTitle">
      <div class="card-modal-header">
        <h2 id="cardModalTitle" class="card-modal-title">Player</h2>
        <div class="card-modal-actions">
          <a id="cardModalPageLink" class="modal-link-btn modal-page-btn" target="_blank" rel="noopener noreferrer">Open in New Page</a>
          <a id="cardModalOpenLink" class="modal-link-btn" target="_blank" rel="noopener noreferrer">Tracker</a>
          <button id="cardModalClose" class="modal-close-btn" type="button" aria-label="Close popup">×</button>
        </div>
      </div>
      <div class="card-modal-body" id="cardModalBody"></div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#cardModalClose").addEventListener("click", () => {
    modal.classList.remove("open");
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) {
      modal.classList.remove("open");
    }
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      modal.classList.remove("open");
    }
  });

  return modal;
}

function openCardModal(player) {
  const modal = ensureCardModal();
  const title = modal.querySelector("#cardModalTitle");
  const body = modal.querySelector("#cardModalBody");
  const openLink = modal.querySelector("#cardModalOpenLink");
  const pageLink = modal.querySelector("#cardModalPageLink");

  const currentActLabel = getActLabel(currentAct);
  const winRateValue = Number(player.winrate) || 0;

  const playerPayload = {
    player,
    currentAct,
    currentActLabel,
  };

  const playerPageUrl =
    `player.html?payload=${encodeURIComponent(JSON.stringify(playerPayload))}`;

  try {
    localStorage.setItem("valoStatPlayerPayload", JSON.stringify(playerPayload));
  } catch (error) {
    console.error("Unable to store player payload for player page:", error);
  }

  title.textContent = `${player.id} · ${currentActLabel}`;

  const wins = Number(player.wins) || 0;
  const matches = Number(player.matches) || 0;
  const losses = Math.max(0, matches - wins);

  const averagePerformance = player.avg_performance_score == null
    ? "N/A"
    : formatStat(player.avg_performance_score);

  const performanceMatches = Number(player.performance_score_matches) || 0;

  body.innerHTML = `
    <section class="modal-hero">
      <div class="modal-hero-art">
        <img src="${escapeHtml(player.banner || "")}" alt="${escapeHtml(player.id)} banner" />
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
        <span class="modal-score-label">ValoStat Score</span>
        <strong>${valoStatScore(player)}<small>/1000</small></strong>
        <span class="modal-score-sub">${escapeHtml(currentActLabel)}</span>
      </div>
    </section>

    <section class="modal-stats-grid">
      <article class="modal-stat-card">
        <span>Win %</span>
        <strong>${formatStat(player.winrate)}%</strong>
        <small>${wins}/${matches} matches</small>
      </article>

      <article class="modal-stat-card">
        <span>Avg Performance</span>
        <strong>${averagePerformance}</strong>
        <small>Average ACS: ${formatStat(player.avg_acs)}</small>
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
        <p><strong>Kills / Deaths / Assists</strong></p>
        <p>${formatStat(player.kills_total)} / ${formatStat(player.deaths_total)} / ${formatStat(player.assists_total)}</p>
      </div>

      <div>
        <p><strong>Acts Counted</strong></p>
        <p>${player.actCount || 1}</p>
      </div>

      <div>
        <p><strong>Acts Played</strong></p>
        <p>${player.actsPlayed ? escapeHtml(player.actsPlayed.toUpperCase()) : escapeHtml(currentActLabel.toUpperCase())}</p>
      </div>
    </section>

    <section class="modal-implemented">
      <p><strong>Extra Stats</strong></p>
      <div class="modal-extra-grid">
        ${buildPlayerExtras(player)}
      </div>
    </section>
  `;

  openLink.href = trackerProfileUrl(player.riot_id || player.id);
  pageLink.href = playerPageUrl;

  modal.classList.add("open");
}

/* ------------------ Act Navigation ------------------ */

function setCurrentAct(act) {
  const nextAct = actMap[act] || act;
  if (nextAct === currentAct) return;

  currentAct = nextAct;

  if (isDefaultActCode(currentAct) || currentAct === "overall") {
    currentActData = null;
  }

  navButtons.forEach((button) => {
    button.classList.toggle("active", button.dataset.act === act);
  });

  onActChange(act);
}

async function onActChange(act) {
  resetComparison();
  showDiff = false;

  const toggleDiff = document.getElementById("toggleDiff");
  if (toggleDiff) toggleDiff.checked = false;

  if (isDefaultActCode(act)) {
    const data = await renderCards();
    populateDropdowns(data);
    return;
  }

  const data = await renderCards(actMap[act] || act);
  populateDropdowns(data);
}

/* ------------------ ValoStat Score ------------------ */

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function sigmoidNormalize(value, midpoint, steepness) {
  const v = Number.isFinite(value) ? value : 0;
  return 1 / (1 + Math.exp(-(v - midpoint) / steepness));
}

function valoStatScore(p) {
  // Performance score is API-provided and normalized to [0, 1].
  // Missing performance data receives a neutral value until it is available.
  const performance = p.avg_performance_score == null
    ? 0.5
    : sigmoidNormalize(Number(p.avg_performance_score), 200, 60);

  const acs = sigmoidNormalize(Number(p.avg_acs) || 0, 200, 65);
  const kast = clamp((Number(p.kast) || 0) / 100, 0, 1);
  const kad = sigmoidNormalize(Number(p.kad) || 0, 1.2, 0.28);
  const dd = sigmoidNormalize(Number(p.dd_delta) || 0, 0, 30);

  const matchCount = Number(p.matches) || 0;
  const win = matchCount > 0
    ? clamp((Number(p.wins) || 0) / matchCount, 0, 1)
    : 0;

  // Weights:
  // Performance 40%, ACS 20%, KAST 15%, KA/D 10%,
  // damage delta 10%, win rate 5%.
  const score =
    0.40 * performance +
    0.20 * acs +
    0.15 * kast +
    0.10 * kad +
    0.10 * dd +
    0.05 * win;

  return clamp(Math.round(score * 1000), 10, 1000);
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

  return result.trim();
}

function getPlayerMatchKey(player) {
  return player?.puuid || player?.riot_id || player?.id || "";
}

/* ------------------ Load & Render ------------------ */

async function loadStats() {
  const current = await fetch("stats.json?ts=" + Date.now());
  const previousResponse = await fetch("stats_prev.json?ts=" + Date.now())
    .catch(() => null);

  players = await current.json();
  cache = [...players];

  prev = computeDiff(
    cache,
    previousResponse ? await previousResponse.json() : []
  );

  await renderCards();
  populateDropdowns(players);
  lastUpdate(current);
}

function computeDiff(curr, previous) {
  const previousMap = {};

  previous.forEach((player) => {
    if (player?.puuid) previousMap[`puuid:${player.puuid}`] = player;
    if (player?.riot_id) previousMap[`riot_id:${player.riot_id}`] = player;
    if (player?.id) previousMap[`id:${player.id}`] = player;
  });

  const diffs = [];

  curr.forEach((player) => {
    const old =
      previousMap[`puuid:${player.puuid}`] ||
      previousMap[`riot_id:${player.riot_id}`] ||
      previousMap[`id:${player.id}`];

    if (!old) return;

    const scoreChanged = valoStatScore(player) !== valoStatScore(old);

    const diff = {
      id: player.id,
      puuid: player.puuid,
      banner: player.banner,
      riot_id: player.riot_id,

      diff:
        player.matches !== old.matches ||
        player.level !== old.level ||
        player.rank !== old.rank ||
        player.rr !== old.rr ||
        player.wins !== old.wins ||
        player.winrate !== old.winrate ||
        player.time_total !== old.time_total ||
        scoreChanged,

      rank: player.rank !== old.rank
        ? `${old.rank} → ${player.rank}`
        : player.rank,

      level: player.level !== old.level
        ? `${old.level} → ${player.level}`
        : player.level,

      rr: player.rr !== old.rr
        ? `${old.rr} → ${player.rr}`
        : player.rr,

      matches: player.matches !== old.matches
        ? `${old.matches} → ${player.matches}`
        : player.matches,

      wins: player.wins !== old.wins
        ? `${old.wins} → ${player.wins}`
        : player.wins,

      winrate: player.winrate !== old.winrate
        ? `${old.winrate}% → ${player.winrate}%`
        : `${player.winrate}%`,

      time_total: player.time_total !== old.time_total
        ? `${formatTime(old.time_total)} → ${formatTime(player.time_total)}`
        : formatTime(player.time_total),

      score: scoreChanged
        ? `${valoStatScore(old)} → ${valoStatScore(player)}`
        : valoStatScore(player),
    };

    diffs.push(diff);
  });

  return diffs;
}

function lastUpdate(response) {
  const lastModified = response.headers.get("Last-Modified");
  if (!lastModified) return;

  const date = new Date(lastModified);
  const now = new Date();
  const diffMinutes = Math.floor((now - date) / 60000);
  const hours = Math.floor(diffMinutes / 60);
  const minutes = diffMinutes % 60;

  let text = "Stats last updated ";
  if (hours > 0) text += `${hours}h `;
  if (minutes > 0) text += `${minutes}m `;
  text += "ago";

  const updateTime = document.getElementById("updateTime");
  if (updateTime) updateTime.textContent = text;
}

/* ---------- Loading State ---------- */

function showLoading(message = "Calculating scores for overall stats, please wait...") {
  profiles.innerHTML = `
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p class="loading-text">${message}</p>
    </div>
  `;
}

/* ---------- Load Act Data ---------- */

async function loadActData(act) {
  if (isDefaultActCode(act)) {
    return cache;
  }

  if (act === "overall") {
    const combinedData = [...cache];
    const actCount = {};
    const actNames = {};

    combinedData.forEach((player) => {
      actCount[player.id] = 1;
      actNames[player.id] = ["V26: A6"];
    });

    try {
      for (const [displayName, actCode] of Object.entries(actMap)) {
        if (displayName === "overall" || actCode === "e11a6") continue;

        const response = await fetch(`data/${actCode}.json?ts=${Date.now()}`);
        if (!response.ok) continue;

        const actData = await response.json();

        actData.forEach((actPlayer) => {
          const existingIndex = combinedData.findIndex(
            (player) => player.id === actPlayer.id
          );

          if (existingIndex !== -1) {
            const player = combinedData[existingIndex];

            const combinedMatches =
              (player.matches || 0) + (actPlayer.matches || 0);
            const combinedWins =
              (player.wins || 0) + (actPlayer.wins || 0);
            const combinedRounds =
              (player.rounds_total || 0) + (actPlayer.rounds_total || 0);

            const combinedAcs =
              (player.acs_total || 0) + (actPlayer.acs_total || 0);
            const combinedKills =
              (player.kills_total || 0) + (actPlayer.kills_total || 0);
            const combinedDeaths =
              (player.deaths_total || 0) + (actPlayer.deaths_total || 0);
            const combinedAssists =
              (player.assists_total || 0) + (actPlayer.assists_total || 0);
            const combinedKastRounds =
              (player.kast_rounds_total || 0) + (actPlayer.kast_rounds_total || 0);
            const combinedDamageDelta =
              (player.damage_delta_total || 0) + (actPlayer.damage_delta_total || 0);

            const combinedPerformanceTotal =
              (player.performance_score_total || 0) +
              (actPlayer.performance_score_total || 0);

            const combinedPerformanceMatches =
              (player.performance_score_matches || 0) +
              (actPlayer.performance_score_matches || 0);

            const combinedEnemyRankSum =
              (player.enemy_rank_sum || 0) + (actPlayer.enemy_rank_sum || 0);
            const combinedEnemyRankMatches =
              (player.enemy_rank_matches || 0) +
              (actPlayer.enemy_rank_matches || 0);

            const combinedLobbyRankSum =
              (player.lobby_rank_sum || 0) + (actPlayer.lobby_rank_sum || 0);
            const combinedLobbyRankMatches =
              (player.lobby_rank_matches || 0) +
              (actPlayer.lobby_rank_matches || 0);

            combinedData[existingIndex] = {
              ...player,
              matches: combinedMatches,
              wins: combinedWins,
              kills_total: combinedKills,
              deaths_total: combinedDeaths,
              assists_total: combinedAssists,
              time_total: (player.time_total || 0) + (actPlayer.time_total || 0),
              acs_total: combinedAcs,
              damage_delta_total: combinedDamageDelta,
              kast_rounds_total: combinedKastRounds,
              rounds_total: combinedRounds,

              performance_score_total: combinedPerformanceTotal,
              performance_score_matches: combinedPerformanceMatches,

              enemy_rank_sum: combinedEnemyRankSum,
              enemy_rank_matches: combinedEnemyRankMatches,
              lobby_rank_sum: combinedLobbyRankSum,
              lobby_rank_matches: combinedLobbyRankMatches,

              avg_performance_score: combinedPerformanceMatches
                ? combinedPerformanceTotal / combinedPerformanceMatches
                : null,

              enemy_rank_average_value: combinedEnemyRankMatches
                ? combinedEnemyRankSum / combinedEnemyRankMatches
                : null,

              lobby_rank_average_value: combinedLobbyRankMatches
                ? combinedLobbyRankSum / combinedLobbyRankMatches
                : null,

              avg_acs: combinedRounds ? combinedAcs / combinedRounds : 0,

              kd: combinedDeaths ? combinedKills / combinedDeaths : combinedKills,

              kad: combinedDeaths
                ? (combinedKills + combinedAssists) / combinedDeaths
                : combinedKills + combinedAssists,

              kast: combinedRounds
                ? (combinedKastRounds / combinedRounds) * 100
                : 0,

              dd_delta: combinedRounds
                ? combinedDamageDelta / combinedRounds
                : 0,
            };

            actCount[player.id] = (actCount[player.id] || 1) + 1;
            actNames[player.id].push(displayName);

            if (combinedData[existingIndex].matches > 0) {
              combinedData[existingIndex].winrate = Math.round(
                combinedWins / combinedMatches * 100
              );
            }
          } else {
            combinedData.push(actPlayer);
            actCount[actPlayer.id] = 1;
            actNames[actPlayer.id] = [displayName];
          }
        });
      }

      combinedData.forEach((player) => {
        player.actCount = actCount[player.id];
        player.actsPlayed = actNames[player.id]
          ? actNames[player.id].join(", ")
          : "";
      });
    } catch (error) {
      console.error("Error loading act data:", error);
    }

    return combinedData;
  }

  try {
    const response = await fetch(`data/${act}.json?ts=${Date.now()}`);
    if (response.ok) return await response.json();
  } catch (error) {
    console.error(`Error loading act data ${act}:`, error);
  }

  return cache;
}

async function renderCards(act = currentAct) {
  const toggleControl = document.querySelector(".toggle-control");

  if (toggleControl) {
    toggleControl.style.display = isDefaultActCode(act) ? "flex" : "none";
  }

  if (act === "overall") {
    showLoading("Calculating scores for overall stats, please wait...");
  }

  const data = await loadActData(act);
  const displayData = [...data];

  if (!displayData || displayData.length === 0) {
    profiles.innerHTML = "<p class='no-changes'>No data available for this act.</p>";
    return displayData || [];
  }

  if (act === "overall" && !overallCache) {
    overallCache = displayData;
  } else if (act !== "e11a6" && act !== "overall") {
    currentActData = displayData;
  }

  const sortType = document.getElementById("sortSelect").value;

  if (sortType !== "default") {
    displayData.sort((a, b) => {
      switch (sortType) {
        case "score":
          return valoStatScore(b) - valoStatScore(a);
        case "rank":
          return (b.elo || 0) - (a.elo || 0);
        case "level":
          return (b.level || 0) - (a.level || 0);
        case "winPercentage":
          return (b.winrate || 0) - (a.winrate || 0);
        case "matchesPlayed":
          return (b.matches || 0) - (a.matches || 0);
        case "kills":
          return ((b.kills_total / b.matches) || 0) -
            ((a.kills_total / a.matches) || 0);
        case "deaths":
          return -1 * (
            ((b.deaths_total / b.matches) || 0) -
            ((a.deaths_total / a.matches) || 0)
          );
        case "assists":
          return ((b.assists_total / b.matches) || 0) -
            ((a.assists_total / a.matches) || 0);
        case "acs":
          return (b.avg_acs || 0) - (a.avg_acs || 0);
        case "kd":
          return (b.kd || 0) - (a.kd || 0);
        case "kad":
          return (b.kad || 0) - (a.kad || 0);
        case "kast":
          return (b.kast || 0) - (a.kast || 0);
        case "dd":
          return (b.dd_delta || 0) - (a.dd_delta || 0);
        case "time":
          return (b.time_total || 0) - (a.time_total || 0);
        default:
          return 0;
      }
    });
  }

  profiles.innerHTML = "";

  if (showDiff && prev.length > 0) {
    const hasDiff = prev.some((player) => player.diff);

    if (!hasDiff) {
      profiles.innerHTML = "<p class='no-changes'>No changes since last update.</p>";
      return displayData;
    }
  }

  displayData.forEach((player) => {
    const score = valoStatScore(player);
    let extraStat = "";

    switch (sortType) {
      case "kills":
        extraStat = `<p><strong>Kills:</strong> ${Math.trunc((player.kills_total / player.matches) * 100) / 100 || 0}</p>`;
        break;
      case "deaths":
        extraStat = `<p><strong>Deaths:</strong> ${Math.trunc((player.deaths_total / player.matches) * 100) / 100 || 0}</p>`;
        break;
      case "assists":
        extraStat = `<p><strong>Assists:</strong> ${Math.trunc((player.assists_total / player.matches) * 100) / 100 || 0}</p>`;
        break;
      case "acs":
        extraStat = `<p><strong>Avg ACS:</strong> ${player.avg_acs || 0}</p>`;
        break;
      case "kd":
        extraStat = `<p><strong>K/D:</strong> ${player.kd || 0}</p>`;
        break;
      case "kad":
        extraStat = `<p><strong>KA/D:</strong> ${player.kad || 0}</p>`;
        break;
      case "kast":
        extraStat = `<p><strong>KAST %:</strong> ${player.kast || 0}%</p>`;
        break;
      case "dd":
        extraStat = `<p><strong>DDΔ / round:</strong> ${player.dd_delta || 0}</p>`;
        break;
      default:
        break;
    }

    const playerKey = getPlayerMatchKey(player);
    const playerDiff = prev.find(
      (item) => getPlayerMatchKey(item) === playerKey
    );

    if (showDiff && playerDiff && playerDiff.diff) {
      profiles.innerHTML += `
        <div class="card diff-highlight" data-player-id="${escapeHtml(player.id)}">
          <img src="${escapeHtml(player.banner || "")}" class="banner" />
          <h3>
            <a href="${trackerProfileUrl(player.riot_id)}" target="_blank" class="player-link">
              ${escapeHtml(player.id)}
            </a>
          </h3>
          <p class="riot-id">${escapeHtml(player.riot_id)}</p>
          <p><strong>Rank:</strong> ${escapeHtml(playerDiff.rank)} (${escapeHtml(playerDiff.rr)} RR)</p>
          <p><strong>Level:</strong> ${escapeHtml(playerDiff.level)}</p>
          <p><strong>Wins:</strong> ${escapeHtml(playerDiff.wins)}/${escapeHtml(playerDiff.matches)}</p>
          <p><strong>Win Rate:</strong> ${escapeHtml(playerDiff.winrate)}</p>
          <p><strong>Playtime:</strong> ${escapeHtml(playerDiff.time_total)}</p>
          ${extraStat}
          <div class="score">
            ValoStat Score: <span>${escapeHtml(playerDiff.score)}</span>
          </div>
        </div>
      `;
      return;
    } else if (showDiff && playerDiff && !playerDiff.diff) {
      return;
    }

    profiles.innerHTML += `
      <div class="card" data-player-id="${escapeHtml(player.id)}">
        <img src="${escapeHtml(player.banner || "")}" class="banner" />
        <h3>
          <a href="${trackerProfileUrl(player.riot_id)}" target="_blank" class="player-link">
            ${escapeHtml(player.id)}
          </a>
        </h3>

        <p class="riot-id">${escapeHtml(player.riot_id)}</p>

        <p><strong>Rank:</strong> ${escapeHtml(player.rank)} (${escapeHtml(player.rr)} RR)</p>
        <p><strong>Level:</strong> ${escapeHtml(player.level)}</p>
        <p><strong>Wins:</strong> ${escapeHtml(player.wins)}/${escapeHtml(player.matches)}</p>
        <p><strong>Win Rate:</strong> ${escapeHtml(player.winrate)}%</p>
        <p><strong>Playtime:</strong> ${formatTime(player.time_total)}</p>
        ${player.actCount ? `<p><strong>Acts Counted:</strong> ${player.actCount}</p>` : ""}
        ${extraStat}
        <div class="score">
          ValoStat Score: <span>${score}</span>
        </div>
      </div>
    `;
  });

  return displayData;
}

function populateDropdowns(data) {
  selectA.innerHTML = "";
  selectB.innerHTML = "";

  data.forEach((player) => {
    selectA.add(new Option(player.id, player.id));
    selectB.add(new Option(player.id, player.id));
  });
}

/* ---------- Comparison Data ---------- */

function getComparisonData() {
  if (isDefaultActCode(currentAct)) return cache;
  if (currentAct === "overall") return overallCache;
  return currentActData || cache;
}

function resetComparison() {
  try {
    if (comparison && comparison.innerHTML.trim() !== "") {
      comparison.innerHTML = "";
    }

    if (selectA) selectA.selectedIndex = 0;
    if (selectB) selectB.selectedIndex = 0;

    const resetBtn = document.getElementById("resetCompareBtn");
    if (resetBtn) resetBtn.remove();
  } catch (error) {
    console.warn("resetComparison failed", error);
  }
}

/* ------------------ Comparison ------------------ */

compareBtn.addEventListener("click", () => {
  const data = getComparisonData();
  if (!data || data.length === 0) return;

  const a = data.find((player) => player.id === selectA.value);
  const b = data.find((player) => player.id === selectB.value);

  if (!a || !b || a.id === b.id) return;

  renderComparison(a, b);
});

const rankValues = {
  "Iron 1": 1,
  "Iron 2": 2,
  "Iron 3": 3,
  "Bronze 1": 4,
  "Bronze 2": 5,
  "Bronze 3": 6,
  "Silver 1": 7,
  "Silver 2": 8,
  "Silver 3": 9,
  "Gold 1": 10,
  "Gold 2": 11,
  "Gold 3": 12,
  "Platinum 1": 13,
  "Platinum 2": 14,
  "Platinum 3": 15,
  "Diamond 1": 16,
  "Diamond 2": 17,
  "Diamond 3": 18,
  "Ascendant 1": 19,
  "Ascendant 2": 20,
  "Ascendant 3": 21,
  "Immortal 1": 22,
  "Immortal 2": 23,
  "Immortal 3": 24,
  "Radiant": 25,
};

function statRow(a, b, higherBetter = true, rank = false, isTime = false) {
  let compareA = a;
  let compareB = b;
  let displayA = a;
  let displayB = b;

  if (rank) {
    compareA = rankValues[a] || 0;
    compareB = rankValues[b] || 0;
  }

  if (isTime) {
    displayA = formatTime(a);
    displayB = formatTime(b);
  } else {
    displayA = formatStat(a);
    displayB = formatStat(b);
  }

  if (compareA === compareB) {
    return `<td class="equal-stat">${displayA}</td><td class="equal-stat">${displayB}</td>`;
  }

  const goodA = higherBetter
    ? compareA > compareB
    : compareA < compareB;

  return goodA
    ? `<td class="good-stat">${displayA}</td><td class="bad-stat">${displayB}</td>`
    : `<td class="bad-stat">${displayA}</td><td class="good-stat">${displayB}</td>`;
}

function renderComparison(a, b) {
  comparison.innerHTML = `
    <table>
      <tr>
        <th>Stat</th>
        <th>${escapeHtml(a.id)}</th>
        <th>${escapeHtml(b.id)}</th>
      </tr>

      <tr>
        <td>Rank</td>
        ${statRow(a.rank, b.rank, true, true)}
      </tr>

      <tr>
        <td>RR</td>
        ${statRow(a.rr, b.rr)}
      </tr>

      <tr>
        <td>ValoStat Score</td>
        ${statRow(valoStatScore(a), valoStatScore(b))}
      </tr>

      ${a.actCount || b.actCount ? `
        <tr><td>Acts Counted</td>${statRow(a.actCount || 1, b.actCount || 1)}</tr>
      ` : ""}

      ${a.actsPlayed || b.actsPlayed ? `
        <tr>
          <td>Acts Played</td>
          <td>${escapeHtml(a.actsPlayed?.toUpperCase() || "N/A")}</td>
          <td>${escapeHtml(b.actsPlayed?.toUpperCase() || "N/A")}</td>
        </tr>
      ` : ""}

      <tr><td>Playtime</td>${statRow(a.time_total, b.time_total, true, false, true)}</tr>
      <tr><td>Matches</td>${statRow(a.matches, b.matches)}</tr>
      <tr><td>Winrate %</td>${statRow(a.winrate, b.winrate)}</tr>
      <tr><td>Avg Performance</td>${statRow(a.avg_performance_score, b.avg_performance_score)}</tr>
      <tr><td>Avg ACS</td>${statRow(a.avg_acs, b.avg_acs)}</tr>
      <tr><td>K/D</td>${statRow(a.kd, b.kd)}</tr>
      <tr><td>KA/D</td>${statRow(a.kad, b.kad)}</tr>
      <tr><td>KAST %</td>${statRow(a.kast, b.kast)}</tr>
      <tr><td>DDΔ / round</td>${statRow(a.dd_delta, b.dd_delta)}</tr>
    </table>
  `;

  try {
    let resetBtn = document.getElementById("resetCompareBtn");

    if (!resetBtn) {
      resetBtn = document.createElement("button");
      resetBtn.id = "resetCompareBtn";
      resetBtn.type = "button";
      resetBtn.className = "reset-compare-btn";
      resetBtn.textContent = "Reset";
      resetBtn.addEventListener("click", resetComparison);

      if (compareBtn && compareBtn.parentNode) {
        compareBtn.parentNode.insertBefore(resetBtn, compareBtn.nextSibling);
      }
    } else {
      resetBtn.style.display = "inline-block";
    }
  } catch (error) {
    console.warn("Unable to add reset button for comparison", error);
  }
}

/* ------------------ Start App ------------------ */

loadStats();

navButtons.forEach((button) => {
  button.addEventListener("click", (event) => {
    setCurrentAct(event.currentTarget.dataset.act);
  });
});

document.getElementById("sortSelect").addEventListener("change", async () => {
  await renderCards();
});

document.getElementById("toggleDiff").addEventListener("change", async (event) => {
  showDiff = event.target.checked;
  await renderCards();
});

profiles.addEventListener("click", (event) => {
  const card = event.target.closest(".card");
  if (!card) return;

  if (event.target.closest("a.player-link")) {
    event.preventDefault();
  }

  const selectedData = getComparisonData();
  if (!selectedData || selectedData.length === 0) return;

  const playerId = card.dataset.playerId;
  const player = selectedData.find((item) => item.id === playerId);

  if (!player) return;

  openCardModal(player);
});