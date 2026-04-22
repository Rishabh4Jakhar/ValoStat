const profiles = document.getElementById("profiles");
const selectA = document.getElementById("playerA");
const selectB = document.getElementById("playerB");
const compareBtn = document.getElementById("compareBtn");
const comparison = document.getElementById("comparison");

let players = [];
let cache = {};
let prev = null;
let showDiff = false;

function trackerProfileUrl(riotId) {
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(riotId)}/overview`;
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
  renderCards();
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
      diff: p.matches !== old.matches ? true: false,
      rank: p.rank !== old.rank ? `${old.rank} → ${p.rank}` : p.rank,
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

function renderCards() {
  const sortType = document.getElementById("sortSelect").value;
  let data = [...cache];
  if (sortType !== "default") {
    data.sort((a, b) => {
      switch (sortType) {
        case "score":
          return valoStatScore(b) - valoStatScore(a);
        case "rank":
          return (b.elo || 0) - (a.elo || 0);
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
      return;
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
        <div class="card diff-highlight">
          <img src="${p.banner}" class="banner" />
          <h3>
            <a href="${trackerProfileUrl(p.riot_id)}" target="_blank" class="player-link">
              ${p.id}
            </a>
          </h3>

          <p class="riot-id">${p.riot_id}</p>
          <p><strong>Rank:</strong> ${playerDiff.rank} (${playerDiff.rr} RR)</p>
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
      <div class="card">
        <img src="${p.banner}" class="banner" />
        <h3>
          <a href="${trackerProfileUrl(p.riot_id)}" target="_blank" class="player-link">
            ${p.id}
          </a>
        </h3>

        <p class="riot-id">${p.riot_id}</p>

        <p><strong>Rank:</strong> ${p.rank} (${p.rr} RR)</p>
        <p><strong>Wins:</strong> ${p.wins}/${p.matches}</p>
        <p><strong>Win Rate:</strong> ${p.winrate}%</p>
        <p><strong>Playtime:</strong> ${formatTime(p.time_total)}</p>
        ${extraStat}
        <div class="score">
          ValoStat Score: <span>${score}</span>
        </div>
      </div>
    `;
  });
}

function populateDropdowns(data) {
  selectA.innerHTML = "";
  selectB.innerHTML = "";

  data.forEach((p) => {
    selectA.add(new Option(p.id, p.id));
    selectB.add(new Option(p.id, p.id));
  });
}

/* ------------------ Comparison ------------------ */

compareBtn.addEventListener("click", () => {
  const a = players.find((p) => p.id === selectA.value);
  const b = players.find((p) => p.id === selectB.value);
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
document.getElementById("sortSelect").addEventListener("change", () => {
  renderCards();
});
document.getElementById("toggleDiff").addEventListener("change", (e) => {
  showDiff = !showDiff;
  renderCards();
});