const navButtons = document.querySelectorAll(".nav-btn");
const profiles = document.getElementById("profiles");
const selectA = document.getElementById("playerA");
const selectB = document.getElementById("playerB");
const compareBtn = document.getElementById("compareBtn");
const comparison = document.getElementById("comparison");
const defaultAct = "v26-a3"; 

let players = [];
let cache = {}; // Stores data of default act (on page load)
let overallCache = null; // Stores overall act data (calculated once, reused)
let currentActData = null; // Temp variable for other acts, replaced each time
let prev = null;
let showDiff = false;
let currentAct = defaultAct;
let actMap = {
  "overall": "overall",
  "v26-a3": "e11a3",
  "v26-a2": "e11a2",
  // Add more acts here as needed
};

function trackerProfileUrl(riotId) {
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(riotId)}/overview`;
}

function getActLabel(actCode) {
  if (actCode === "overall") return "Overall";
  if (actCode === "e11a3" || actCode === defaultAct) return "V26: A3";
  if (actCode === "e11a2") return "V26: A2";
  return String(actCode || "Player").toUpperCase();
}

function formatStat(value) {
  // If a number has more than 2 decimal places, format to 2 decimals. Otherwise return as is. If not a number, return "0.00"
  const numeric = Number(value);
  if (isNaN(numeric)) return "0.00";
  return numeric.toFixed(2);
}

function buildPlayerExtras(player) {
  const entries = [
    ["Kills Total", player.kills_total],
    ["ACS Total", player.acs_total],
    ["Deaths Total", player.deaths_total],
    ["Assists Total", player.assists_total],
    ["KAST Rounds Total", player.kast_rounds_total],
    ["Damage Delta Total", player.damage_delta_total],
  ];

  return entries
    .filter(([, value]) => value !== undefined && value !== null && value !== "")
    .map(([label, value]) => `
      <div class="modal-extra-item">
        <span>${escapeHtml(label)}</span>
        <strong>${value}</strong>
      </div>
    `)
    .join("");
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
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

  const closeButton = modal.querySelector("#cardModalClose");
  closeButton.addEventListener("click", () => {
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
  const playerPageUrl = `player.html?payload=${encodeURIComponent(JSON.stringify(playerPayload))}`;

  try {
    localStorage.setItem("valoStatPlayerPayload", JSON.stringify(playerPayload));
  } catch (error) {
    console.error("Unable to store player payload for player page:", error);
  }

  // Write every player stat stored in the player object to the modal
  title.textContent = `${player.id} · ${currentActLabel}`;
  const wins = Number(player.wins) || 0;
  const losses = (Number(player.matches) || 0) - wins;
  body.innerHTML = `
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
        <strong>${valoStatScore(player)}<small>/1000</small></strong>
        <span class="modal-score-sub">${currentActLabel}</span>
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
        <small>Total Rounds: ${player.acs_total}</small>
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
        <p>${player.kills_total} / ${player.deaths_total} / ${player.assists_total}</p>
      </div>      
      <div>
        <p><strong>Acts Counted</strong></p>
        <p>${player.actCount || 1}</p>
      </div>
      <div>
        <p><strong>Acts Played</strong></p>
        <p>${player.actsPlayed ? escapeHtml(player.actsPlayed.toUpperCase()) : currentActLabel.toUpperCase()}</p>
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
  if (act === currentAct) return; // No change
  currentAct = actMap[act] || act; // Map display name to internal act code
  
  navButtons.forEach(btn => {
    if (btn.dataset.act === act) {
      btn.classList.add("active");
    } else {
      btn.classList.remove("active");
    }
  });
  
  // Reload data based on selected act
  onActChange(act);
}

async function onActChange(act) {
  if (act === defaultAct) { // Stats.json is default act stats, already loaded on page load, so just re-render cards
    const data = await renderCards();
    populateDropdowns(data);
    return;
  }
  //console.log("Act changed to:", act);
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
  // Bounded [0,1] transforms prevent any single metric from overpowering the final score.
  const acs = sigmoidNormalize(p.avg_acs, 200, 65);
  const kast = clamp(p.kast / 100, 0, 1);
  const kad = sigmoidNormalize(p.kad, 1.2, 0.28);
  const dd = sigmoidNormalize(p.dd_delta, 0, 30);
  const win = p.matches > 0 ? clamp(p.wins / p.matches, 0, 1) : 0;

  const score = 0.3 * acs + 0.2 * kast + 0.15 * kad + 0.25 * dd + 0.1 * win;

  return clamp(Math.round(score * 1000), 10, 1000);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  let result = "";
  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  if (seconds > 0 || result === "") result += `${seconds}s`;
  return result;
}

/* ------------------ Load & Render ------------------ */

async function loadStats() {
  const current = await fetch("stats.json?ts=" + Date.now());
  const prevs = await fetch("stats_prev.json?ts=" + Date.now()).catch(() => null);
  players = await current.json();
  cache = players;
  prev = computeDiff(cache, prevs ? await prevs.json() : []);
  await renderCards();
  populateDropdowns(players);
  lastUpdate(current);
}

function computeDiff(curr, prev) { // Find players whose stats have changed since the last fetch
  const prevMap = {};
  prev.forEach((p) => (prevMap[p.id] = p));
  const diffs = [];
  curr.forEach((p) => {
    const old = prevMap[p.id];
    if (!old) return;
    const diff = {
      id: p.id,
      banner: p.banner,
      //diff: p.matches !== old.matches ? true: false,
      // Make diff true if either matches or level or any other stat changes 
      diff: p.matches !== old.matches || p.level !== old.level || p.rank !== old.rank || p.rr !== old.rr || p.wins !== old.wins || p.winrate !== old.winrate || p.time_total !== old.time_total || valoStatScore(p) !== valoStatScore(old) ? true : false,
      rank: p.rank !== old.rank ? `${old.rank} → ${p.rank}` : p.rank,
      level: p.level !== old.level ? `${old.level} → ${p.level}` : p.level,
      rr: p.rr !== old.rr ? `${old.rr} → ${p.rr}` : p.rr,
      matches: p.matches !== old.matches ? `${old.matches} → ${p.matches}` : p.matches,
      wins: p.wins !== old.wins ? `${old.wins} → ${p.wins}` : p.wins,
      winrate:
        p.winrate !== old.winrate
          ? `${old.winrate}% → ${p.winrate}%`
          : `${p.winrate}%`,
      time_total:        p.time_total !== old.time_total
          ? `${formatTime(old.time_total)} → ${formatTime(p.time_total)}`
          : formatTime(p.time_total),
      score: valoStatScore(p) !== valoStatScore(old)        ? `${valoStatScore(old)} → ${valoStatScore(p)}`
        : valoStatScore(p),
    };
    diffs.push(diff);
  });
  return diffs;
}


function lastUpdate(res) {
  const lastModified = res.headers.get("Last-Modified");
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
  document.getElementById("updateTime").textContent = text;
}

/* ---------- LOADING STATE ---------- */

function showLoading(message = "Calculating scores for overall stats, please wait...") {
  profiles.innerHTML = `
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p class="loading-text">${message}</p>
    </div>
  `;
}

/* ---------- LOAD ACT DATA ---------- */

async function loadActData(act) {
  if (act === "e11a3" || act === defaultAct) {
    // Default act is already in cache from stats.json
    return cache;
  }
  
  if (act === "overall") {
    // Combine all acts: iterate through actMap and fetch all non-overall acts
    let combinedData = [...cache]; // Start with default act
    const actCount = {}; // Track how many acts each player appears in for averaging
    const actNames = {}; // Track which acts each player appears in
    
    // Initialize for cache players (default act)
    combinedData.forEach(p => {
      actCount[p.id] = 1;
      actNames[p.id] = ["V26: A3"]; // Default act name
    });
    
    try {
      // Loop through actMap and fetch all acts except 'overall'
      for (const [displayName, actCode] of Object.entries(actMap)) {
        if (displayName === "overall" || actCode === "e11a3") continue; // Skip overall and default act
        
        const response = await fetch(`data/${actCode}.json?ts=${Date.now()}`);
        if (response.ok) {
          const actData = await response.json();
          
          // Merge act data: combine matching players' stats
          actData.forEach(actPlayer => {
            const existingIndex = combinedData.findIndex(p => p.id === actPlayer.id);
            if (existingIndex !== -1) {
              // Combine stats for matching players
              const player = combinedData[existingIndex];
              const oldCount = actCount[player.id] || 1;
              const newCount = oldCount + 1;
              
              combinedData[existingIndex] = {
                ...player,
                matches: (player.matches || 0) + (actPlayer.matches || 0),
                wins: (player.wins || 0) + (actPlayer.wins || 0),
                kills_total: (player.kills_total || 0) + (actPlayer.kills_total || 0),
                deaths_total: (player.deaths_total || 0) + (actPlayer.deaths_total || 0),
                assists_total: (player.assists_total || 0) + (actPlayer.assists_total || 0),
                time_total: (player.time_total || 0) + (actPlayer.time_total || 0),
                // Recalculate avg stats
                avg_acs: ((player.avg_acs || 0) * oldCount + (actPlayer.avg_acs || 0)) / newCount,
                kd: ((player.kd || 0) * oldCount + (actPlayer.kd || 0)) / newCount,
                kad: ((player.kad || 0) * oldCount + (actPlayer.kad || 0)) / newCount,
                kast: ((player.kast || 0) * oldCount + (actPlayer.kast || 0)) / newCount,
                dd_delta: ((player.dd_delta || 0) * oldCount + (actPlayer.dd_delta || 0)) / newCount,
              };
              actCount[player.id] = newCount;
              actNames[player.id].push(displayName);
              
              // Recalculate winrate
              if (combinedData[existingIndex].matches > 0) {
                combinedData[existingIndex].winrate = Math.round(
                  (combinedData[existingIndex].wins / combinedData[existingIndex].matches) * 100
                );
              }
            } else {
              // Add new player from this act
              combinedData.push(actPlayer);
              actCount[actPlayer.id] = 1;
              actNames[actPlayer.id] = [displayName];
            }
          });
        }
      }
      
      // Attach act info to players for display
      combinedData.forEach(p => {
        p.actCount = actCount[p.id];
        p.actsPlayed = actNames[p.id] ? actNames[p.id].join(", ") : "";
      });
    } catch (error) {
      console.error("Error loading act data:", error);
    }
    
    return combinedData;
  }
  
  // Load specific act data
  try {
    const response = await fetch(`data/${act}.json?ts=${Date.now()}`);
    if (response.ok) {
      return await response.json();
    }
  } catch (error) {
    console.error(`Error loading act data ${act}:`, error);
  }
  
  return cache; // Fallback to cache
}

async function renderCards(act = currentAct) {

  // Only show toggle for the default act (e11a3), hide for all others
  const toggleControl = document.querySelector(".toggle-control");
  if (toggleControl) {
    if (act === "e11a3" || act === defaultAct) {
      toggleControl.style.display = "flex";
    } else {
      toggleControl.style.display = "none";
    }
  }
  
  // Show loading spinner if loading overall stats
  if (act === "overall") {
    showLoading("Calculating scores for overall stats, please wait...");
  }
  
  // Load data based on act
  let data = await loadActData(act);

  if (!data || data.length === 0) {
    profiles.innerHTML = "<p class='no-changes'>No data available for this act.</p>";
    return data || [];
  }
  // Store displayed data for comparison based on act
  if (act === "overall" && !overallCache) {
    overallCache = data;
  } else if (act !== "e11a3" && act !== "overall") {
    currentActData = data;
  }
  // For default act (e11a3), cache is already set from loadStats()


  // Sorting
  const sortType = document.getElementById("sortSelect").value;
  if (sortType !== "default") {
    data.sort((a, b) => {
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
          return (
            (b.kills_total / b.matches || 0) - (a.kills_total / a.matches || 0)
          );
        case "deaths":
          return (
            -1 *
            ((b.deaths_total / b.matches || 0) -
              (a.deaths_total / a.matches || 0))
          );
        case "assists":
          return (
            (b.assists_total / b.matches || 0) -
            (a.assists_total / a.matches || 0)
          );
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
          return cache;
      }
    });
  }

  profiles.innerHTML = "";

  // Show diff arrows if toggled and data has changed since last fetch
  // Check if prev[i].diff is true 
  // If false, show no changes text. If true, show old → new values for changed stats and highlight card.
  if (showDiff && prev.length > 0) {
    const hasDiff = prev.some((p) => p.diff);
    if (!hasDiff) {
      profiles.innerHTML = "<p class='no-changes'>No changes since last update.</p>";
      return data;
    }
  }

  data.forEach((p) => {
    const score = valoStatScore(p);
    let extraStat = "";
    switch (sortType) {
      case "kills":
        extraStat = `<p><strong>Kills:</strong> ${Math.trunc((p.kills_total / p.matches) * 100) / 100 || 0}</p>`;
        break;
      case "deaths":
        extraStat = `<p><strong>Deaths:</strong> ${Math.trunc((p.deaths_total / p.matches) * 100) / 100 || 0}</p>`;
        break;
      case "assists":
        extraStat = `<p><strong>Assists:</strong> ${Math.trunc((p.assists_total / p.matches) * 100) / 100 || 0}</p>`;
        break;
      case "acs":
        extraStat = `<p><strong>Avg ACS:</strong> ${p.avg_acs || 0}</p>`;
        break;
      case "kd":
        extraStat = `<p><strong>K/D:</strong> ${p.kd || 0}</p>`;
        break;
      case "kad":
        extraStat = `<p><strong>KA/D:</strong> ${p.kad || 0}</p>`;
        break;
      case "kast":
        extraStat = `<p><strong>KAST %:</strong> ${p.kast || 0}%</p>`;
        break;
      case "dd":
        extraStat = `<p><strong>DDΔ / round:</strong> ${p.dd_delta || 0}</p>`;
        break;
      default:
        break;
    }

    // Check if prev diff is true for this player
    const playerDiff = prev.find(d => d.id === p.id);
    if (showDiff && playerDiff && playerDiff.diff) {
      //console.log("diff found for", p.id);
      profiles.innerHTML += `
        <div class="card diff-highlight" data-player-id="${escapeHtml(p.id)}">
          <img src="${p.banner}" class="banner" />
          <h3>
            <a href="${trackerProfileUrl(p.riot_id)}" target="_blank" class="player-link">
              ${p.id}
            </a>
          </h3>

          <p class="riot-id">${p.riot_id}</p>
          <p><strong>Rank:</strong> ${playerDiff.rank} (${playerDiff.rr} RR)</p>
          <p><strong>Level:</strong> ${p.level}</p>
          <p><strong>Wins:</strong> ${playerDiff.wins}/${playerDiff.matches}</p>
          <p><strong>Win Rate:</strong> ${playerDiff.winrate}</p>
          <p><strong>Playtime:</strong> ${playerDiff.time_total}</p>
          ${extraStat}
          <div class="score">
            ValoStat Score: <span>${playerDiff.score}</span>
          </div>
        </div>
      `;
      return;
    } else if (showDiff && playerDiff && !playerDiff.diff) {
      //console.log("No diff for", p.id);
      return;
    }

    profiles.innerHTML += `
      <div class="card" data-player-id="${escapeHtml(p.id)}">
        <img src="${p.banner}" class="banner" />
        <h3>
          <a href="${trackerProfileUrl(p.riot_id)}" target="_blank" class="player-link">
            ${p.id}
          </a>
        </h3>

        <p class="riot-id">${p.riot_id}</p>

        <p><strong>Rank:</strong> ${p.rank} (${p.rr} RR)</p>
        <p><strong>Level:</strong> ${p.level}</p>
        <p><strong>Wins:</strong> ${p.wins}/${p.matches}</p>
        <p><strong>Win Rate:</strong> ${p.winrate}%</p>
        <p><strong>Playtime:</strong> ${formatTime(p.time_total)}</p>
        ${p.actCount ? `<p><strong>Acts Counted:</strong> ${p.actCount}</p>` : ''}
        ${extraStat}
        <div class="score">
          ValoStat Score: <span>${score}</span>
        </div>
      </div>
    `;
  });
  
  return data;
}

function populateDropdowns(data) {
  selectA.innerHTML = "";
  selectB.innerHTML = "";

  data.forEach((p) => {
    selectA.add(new Option(p.id, p.id));
    selectB.add(new Option(p.id, p.id));
  });
}

/* ---------- Helper function to get current act data ---------- */
function getComparisonData() {
  if (currentAct === defaultAct) return cache;
  if (currentAct === "overall") return overallCache;
  return currentActData || cache;
}

/* ------------------ Comparison ------------------ */

compareBtn.addEventListener("click", () => {
  const data = getComparisonData();
  if (!data || data.length === 0) return; // No data to compare
  
  const a = data.find((p) => p.id === selectA.value);
  const b = data.find((p) => p.id === selectB.value);
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
  Radiant: 25,
};

function statRow(a, b, higherBetter = true, rank = false, isTime = false) {
  let compareA = a;
  let compareB = b;

  if (rank) {
    compareA = rankValues[a] || 0;
    compareB = rankValues[b] || 0;
  }
  if (isTime) {
    a = formatTime(a);
    b = formatTime(b);
  }
  console.log(compareA, compareB);
  if (compareA === compareB) {
    return `<td class="equal-stat">${a}</td><td class="equal-stat">${b}</td>`;
  }

  const goodA = higherBetter ? compareA > compareB : compareA < compareB;

  return goodA
    ? `<td class="good-stat">${a}</td><td class="bad-stat">${b}</td>`
    : `<td class="bad-stat">${a}</td><td class="good-stat">${b}</td>`;
}

function renderComparison(a, b) {
  comparison.innerHTML = `
    <div class="compare-card">
    </div>

    <table>
      <tr>
        <th>Stat</th>
        <th>${a.id}</th>
        <th>${b.id}</th>
      </tr>

      <tr><td>Rank</td>${
        a.rank === b.rank
          ? `<td class="equal-stat">${a.rank}</td><td class="equal-stat">${b.rank}</td><tr><td>RR</td>${statRow(a.rr, b.rr)}</td></tr>`
          : statRow(a.rank, b.rank, true, true)
      }</tr>
      <tr><td>ValoStat Score</td>${statRow(valoStatScore(a), valoStatScore(b))}</tr>
      ${a.actCount || b.actCount ? `<tr><td>Acts Counted</td>${statRow(a.actCount, b.actCount)}</tr>` : ''}
      ${a.actsPlayed || b.actsPlayed ? `<tr><td>Acts Played</td><td>${a.actsPlayed?.toUpperCase() || "N/A"}</td><td>${b.actsPlayed?.toUpperCase() || "N/A"}</td></tr>` : ''}
      <tr><td>Playtime</td>${statRow(a.time_total, b.time_total, true, false, true)}</tr>
      <tr><td>Matches</td>${statRow(a.matches, b.matches)}</tr>
      <tr><td>Winrate %</td>${statRow(a.winrate, b.winrate)}</tr>
      <tr><td>Avg ACS</td>${statRow(a.avg_acs, b.avg_acs)}</tr>
      <tr><td>K/D</td>${statRow(a.kd, b.kd)}</tr>
      <tr><td>KA/D</td>${statRow(a.kad, b.kad)}</tr>
      <tr><td>KAST %</td>${statRow(a.kast, b.kast)}</tr>
      <tr><td>DDΔ / round </td>${statRow(a.dd_delta, b.dd_delta)}</tr>
    </table>
  `;
}


loadStats();
// Add click event listeners to all navbar buttons
navButtons.forEach(button => {
  button.addEventListener("click", (e) => {
    const selectedAct = e.target.dataset.act;
    setCurrentAct(selectedAct);
  });
});

document.getElementById("sortSelect").addEventListener("change", async () => {
  await renderCards();
});
document.getElementById("toggleDiff").addEventListener("change", async (e) => {
  showDiff = !showDiff;
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
  const player = selectedData.find((p) => p.id === playerId);
  if (!player) return;

  openCardModal(player);
});