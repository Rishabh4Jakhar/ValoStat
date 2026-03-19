const profiles = document.getElementById("profiles");
const selectA = document.getElementById("playerA");
const selectB = document.getElementById("playerB");
const compareBtn = document.getElementById("compareBtn");
const comparison = document.getElementById("comparison");

let players = [];

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

  const score =
    0.30 * acs +
    0.20 * kast +
    0.15 * kad +
    0.25 * dd +
    0.10 * win;

  return clamp(Math.round(score * 1000), 10, 1000);
}

/* ------------------ Load & Render ------------------ */

async function loadStats() {
  const res = await fetch("stats.json?ts=" + Date.now());
  players = await res.json();

  renderCards(players);
  populateDropdowns(players);
  lastUpdate(res);
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

function renderCards(data) {
  profiles.innerHTML = "";

  data.forEach(p => {
    const score = valoStatScore(p);

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

  data.forEach(p => {
    selectA.add(new Option(p.id, p.id));
    selectB.add(new Option(p.id, p.id));
  });
}

/* ------------------ Comparison ------------------ */

compareBtn.addEventListener("click", () => {
  const a = players.find(p => p.id === selectA.value);
  const b = players.find(p => p.id === selectB.value);
  if (!a || !b || a.id === b.id) return;

  renderComparison(a, b);
});

const rankValues = {
  "Iron 1": 1, "Iron 2": 2, "Iron 3": 3,
  "Bronze 1": 4, "Bronze 2": 5, "Bronze 3": 6,
  "Silver 1": 7, "Silver 2": 8, "Silver 3": 9,
  "Gold 1": 10, "Gold 2": 11, "Gold 3": 12,
  "Platinum 1": 13, "Platinum 2": 14, "Platinum 3": 15,
  "Diamond 1": 16, "Diamond 2": 17, "Diamond 3": 18,
  "Ascendant 1": 19, "Ascendant 2": 20, "Ascendant 3": 21,
  "Immortal 1": 22, "Immortal 2": 23, "Immortal 3": 24,
  "Radiant": 25
};

function statRow(a, b, higherBetter = true, rank = false) {
  let compareA = a;
  let compareB = b;

  if (rank) {
    compareA = rankValues[a] || 0;
    compareB = rankValues[b] || 0;
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
