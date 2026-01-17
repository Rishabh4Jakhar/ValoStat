const profiles = document.getElementById("profiles");
const selectA = document.getElementById("playerA");
const selectB = document.getElementById("playerB");
const compareBtn = document.getElementById("compareBtn");
const comparison = document.getElementById("comparison");

let players = [];

async function loadStats() {
  const res = await fetch("stats.json?ts=" + Date.now());
  players = await res.json();

  renderCards(players);
  populateDropdowns(players);
}

function renderCards(data) {
  profiles.innerHTML = "";

  data.forEach(p => {
    const good = p.winrate >= 55 ? "good" : "";
    profiles.innerHTML += `
      <div class="card ${good}">
        <h3>${p.name}</h3>
        <p><strong>Rank:</strong> ${p.rank} (${p.rr} RR)</p>
        <p>K/D: ${p.kd}</p>
        <p>Winrate: ${p.winrate}%</p>
        <p>Matches: ${p.matches}</p>
      </div>
    `;
  });
}

function populateDropdowns(data) {
  data.forEach(p => {
    const optA = new Option(p.name, p.id);
    const optB = new Option(p.name, p.id);
    selectA.add(optA);
    selectB.add(optB);
  });
}

compareBtn.addEventListener("click", () => {
  const a = players.find(p => p.id === selectA.value);
  const b = players.find(p => p.id === selectB.value);
  if (!a || !b || a.id === b.id) return;

  renderComparison(a, b);
});

function statCell(a, b) {
  if (a === b) return `<td>${a}</td>`;
  return a > b
    ? `<td class="good-stat">${a}</td><td class="bad-stat">${b}</td>`
    : `<td class="bad-stat">${a}</td><td class="good-stat">${b}</td>`;
}

function renderComparison(a, b) {
  comparison.innerHTML = `
    <table>
      <tr>
        <th>Stat</th>
        <th>${a.name}</th>
        <th>${b.name}</th>
      </tr>
      <tr>
        <td>K/D</td>
        ${statRow(a.kd, b.kd)}
      </tr>
      <tr>
        <td>Winrate</td>
        ${statRow(a.winrate, b.winrate)}
      </tr>
      <tr>
        <td>Matches</td>
        ${statRow(a.matches, b.matches)}
      </tr>
    </table>
  `;
}

function statRow(a, b) {
  if (a === b) return `<td>${a}</td><td>${b}</td>`;
  return a > b
    ? `<td class="good-stat">${a}</td><td class="bad-stat">${b}</td>`
    : `<td class="bad-stat">${a}</td><td class="good-stat">${b}</td>`;
}

loadStats();
