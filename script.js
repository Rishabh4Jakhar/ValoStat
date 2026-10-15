const profiles = document.getElementById("profiles");
const selectA = document.getElementById("playerA");
const selectB = document.getElementById("playerB");
const compareBtn = document.getElementById("compareBtn");
const comparison = document.getElementById("comparison");
const isPlayerPage = Boolean(document.getElementById("playerPageRoot"));

// Acts come from acts.json, which the fetch script keeps up to date.
// This copy is only used if acts.json can't be loaded.
const FALLBACK_ACTS = {
  current: "e11a6",
  acts: [
    { code: "e11a6", label: "V26: A6" },
    { code: "e11a5", label: "V26: A5" },
    { code: "e11a4", label: "V26: A4" },
    { code: "e11a3", label: "V26: A3" },
    { code: "e11a2", label: "V26: A2" },
  ],
};

let actsConfig = FALLBACK_ACTS;
let players = [];
let cache = [];
let overallCache = null;
let currentActData = null;
let prev = [];
let showDiff = false;
let currentAct = FALLBACK_ACTS.current;
let lastLoadedAt = 0;
const actFileCache = new Map();

async function loadActsConfig() {
  try {
    const response = await fetch(`acts.json?ts=${Date.now()}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    if (!config?.current || !Array.isArray(config.acts)) throw new Error("unexpected format");
    actsConfig = config;
  } catch (error) {
    console.warn("Using built-in act list; acts.json could not be loaded:", error);
    actsConfig = FALLBACK_ACTS;
  }
  return actsConfig;
}

function isDefaultActCode(act) {
  return act === actsConfig.current;
}

function getActLabel(actCode) {
  if (actCode === "overall") return "Overall";
  const act = actsConfig.acts.find((item) => item.code === actCode);
  return act?.label || String(actCode || "Player").toUpperCase();
}

function trackerProfileUrl(riotId) {
  return `https://tracker.gg/valorant/profile/riot/${encodeURIComponent(riotId)}/overview`;
}

function formatStat(value) {
  if (value === null || value === undefined || value === "") return "N/A";

  const numeric = Number(value);
  if (Number.isNaN(numeric)) return value;
  if (Number.isInteger(numeric)) return String(numeric);

  return numeric.toFixed(2);
}

/* ------------------ Match counts ------------------ */

// "matches" is the season game count from the MMR endpoint (used for win rate).
// The kill/death/assist totals only cover matches the fetcher actually
// processed, so per-match averages must divide by that count instead.
function trackedMatches(player) {
  const tracked = Number(player?.matches_tracked);
  if (Number.isFinite(tracked)) return tracked;
  if (Array.isArray(player?.processed_matches)) return player.processed_matches.length;
  return Number(player?.matches) || 0;
}

function perMatch(player, total) {
  const matches = trackedMatches(player);
  const value = Number(total);
  return matches > 0 && Number.isFinite(value) ? value / matches : null;
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
            ? `<small>(${formatStat(perMatch(player, value))} per match)</small>`
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

/* ------------------ Totals and derived stats ------------------ */
// Mirrors COUNTER_KEYS / derive_summary() in fetch_valo.py so Overall can
// merge the raw totals of several acts and derive the same summary.

const COUNTER_KEYS = [
  "matches", "wins", "losses", "draws",
  "rounds", "rounds_won",
  "time_played_ms",
  "score",
  "kills", "deaths", "assists",
  "headshots", "bodyshots", "legshots",
  "damage_dealt", "damage_received",
  "kast_rounds",
  "first_bloods", "first_deaths",
  "trade_kills", "traded_deaths",
  "multikills_2k", "multikills_3k", "multikills_4k", "aces",
  "clutches",
  "plants", "defuses",
  "match_mvps", "team_mvps",
  "ability_grenade", "ability_1", "ability_2", "ability_ultimate",
  "economy_spent", "loadout_value",
  "afk_rounds",
  "performance_score_total", "performance_score_matches",
  "enemy_rank_sum", "enemy_rank_matches",
  "lobby_rank_sum", "lobby_rank_matches",
];

const MAP_COUNTER_KEYS = ["matches", "wins", "losses", "draws", "rounds", "rounds_won"];

const PERFORMANCE_BREAKDOWN_KEYS = [
  "damage", "trades", "assists", "utility_usage", "plants", "defuses",
  "adjusted_kills", "adjusted_deaths",
];

function num(value) {
  const number = Number(value);
  return value != null && value !== "" && Number.isFinite(number) ? number : 0;
}

function roundTo(value, digits) {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function ratio(numerator, denominator, digits = 2, scale = 1) {
  return denominator ? roundTo((numerator / denominator) * scale, digits) : null;
}

function emptyTotals() {
  const totals = {};
  COUNTER_KEYS.forEach((key) => { totals[key] = 0; });
  totals.performance_breakdown_totals = {};
  PERFORMANCE_BREAKDOWN_KEYS.forEach((key) => { totals.performance_breakdown_totals[key] = 0; });
  totals.performance_grades = {};
  totals.performance_ratings = { combat: {}, utility: {} };
  totals.maps = {};
  return totals;
}

function mergeCounts(target, source) {
  Object.entries(source || {}).forEach(([key, value]) => {
    target[key] = (target[key] || 0) + num(value);
  });
  return target;
}

function mergeRatings(target, source) {
  Object.entries(source || {}).forEach(([group, metrics]) => {
    target[group] = target[group] || {};
    Object.entries(metrics || {}).forEach(([metric, counts]) => {
      target[group][metric] = mergeCounts(target[group][metric] || {}, counts);
    });
  });
  return target;
}

function mergeTotals(target, source) {
  if (!source) return target;

  COUNTER_KEYS.forEach((key) => { target[key] += num(source[key]); });
  PERFORMANCE_BREAKDOWN_KEYS.forEach((key) => {
    target.performance_breakdown_totals[key] += num(source.performance_breakdown_totals?.[key]);
  });
  mergeCounts(target.performance_grades, source.performance_grades);
  mergeRatings(target.performance_ratings, source.performance_ratings);

  Object.entries(source.maps || {}).forEach(([mapName, mapTotals]) => {
    const map = target.maps[mapName] || (target.maps[mapName] = {});
    MAP_COUNTER_KEYS.forEach((key) => { map[key] = (map[key] || 0) + num(mapTotals?.[key]); });
  });

  return target;
}

function deriveSummary(t) {
  const rounds = t.rounds;
  const matches = t.matches;
  const shots = t.headshots + t.bodyshots + t.legshots;
  const perfMatches = t.performance_score_matches;

  const breakdownAverages = {};
  PERFORMANCE_BREAKDOWN_KEYS.forEach((key) => {
    breakdownAverages[key] = ratio(t.performance_breakdown_totals[key], perfMatches, 3);
  });

  const maps = {};
  Object.entries(t.maps)
    .sort((a, b) => b[1].matches - a[1].matches)
    .forEach(([mapName, m]) => {
      maps[mapName] = {
        ...m,
        winrate: ratio(m.wins, m.matches, 1, 100),
        round_winrate: ratio(m.rounds_won, m.rounds, 1, 100),
      };
    });

  return {
    matches,
    wins: t.wins,
    losses: t.losses,
    draws: t.draws,
    winrate: ratio(t.wins, matches, 1, 100),
    rounds,
    round_winrate: ratio(t.rounds_won, rounds, 1, 100),
    time_played_ms: t.time_played_ms,

    acs: ratio(t.score, rounds, 1),
    adr: ratio(t.damage_dealt, rounds, 1),
    dd_delta: ratio(t.damage_dealt - t.damage_received, rounds, 1),
    kd: matches ? ratio(t.kills, Math.max(t.deaths, 1), 2) : null,
    kad: matches ? ratio(t.kills + t.assists, Math.max(t.deaths, 1), 2) : null,
    kast: ratio(t.kast_rounds, rounds, 1, 100),
    hs_percent: ratio(t.headshots, shots, 1, 100),
    kills_per_match: ratio(t.kills, matches, 2),
    deaths_per_match: ratio(t.deaths, matches, 2),
    assists_per_match: ratio(t.assists, matches, 2),
    kills_per_round: ratio(t.kills, rounds, 2),

    first_bloods: t.first_bloods,
    first_deaths: t.first_deaths,
    opening_duel_winrate: ratio(t.first_bloods, t.first_bloods + t.first_deaths, 1, 100),
    trade_kills: t.trade_kills,
    traded_deaths: t.traded_deaths,
    multikills: {
      "2k": t.multikills_2k,
      "3k": t.multikills_3k,
      "4k": t.multikills_4k,
      "5k": t.aces,
    },
    clutches: t.clutches,
    plants: t.plants,
    defuses: t.defuses,
    match_mvps: t.match_mvps,
    team_mvps: t.team_mvps,

    ability_casts_per_round: {
      grenade: ratio(t.ability_grenade, rounds, 2),
      ability_1: ratio(t.ability_1, rounds, 2),
      ability_2: ratio(t.ability_2, rounds, 2),
      ultimate: ratio(t.ability_ultimate, rounds, 2),
    },
    ultimates_per_match: ratio(t.ability_ultimate, matches, 2),
    avg_spent_per_round: ratio(t.economy_spent, rounds, 0),
    avg_loadout_per_round: ratio(t.loadout_value, rounds, 0),

    avg_performance_score: ratio(t.performance_score_total, perfMatches, 2),
    performance_breakdown_averages: breakdownAverages,
    enemy_rank_average_value: ratio(t.enemy_rank_sum, t.enemy_rank_matches, 2),
    lobby_rank_average_value: ratio(t.lobby_rank_sum, t.lobby_rank_matches, 2),

    maps,
  };
}

function buildAgentEntry(totals) {
  const summary = deriveSummary(totals);
  return {
    matches: totals.matches,
    kills: totals.kills,
    deaths: totals.deaths,
    assists: totals.assists,
    time_played_ms: totals.time_played_ms,
    headshot_percentage: summary.hs_percent,
    average_performance_score: summary.avg_performance_score,
    summary,
    totals,
  };
}

// Combine accolade arrays from several acts: counts add up, best value is the max.
function mergeAccolades(lists) {
  const byType = new Map();

  lists.forEach((list) => {
    list.forEach((item) => {
      const type = item?.type;
      if (!type) return;

      const existing = byType.get(type);
      const best = Number(item.best_value);

      if (!existing) {
        byType.set(type, {
          ...item,
          count: num(item.count),
          best_value: Number.isFinite(best) ? best : null,
        });
        return;
      }

      existing.count += num(item.count);
      if (Number.isFinite(best) && (existing.best_value == null || best > existing.best_value)) {
        existing.best_value = best;
      }
    });
  });

  return [...byType.values()];
}

/* ------------------ Modal helpers ------------------ */

function modalNumber(value, digits = 1) {
  const number = Number(value);
  return value == null || value === "" || !Number.isFinite(number)
    ? "N/A"
    : number.toLocaleString(undefined, {
        maximumFractionDigits: digits,
      });
}

function modalPercent(value, digits = 1) {
  return value == null ? "N/A" : `${modalNumber(value, digits)}%`;
}

function modalStat(label, value, note = "") {
  return `
    <article class="modal-stat-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${note ? `<small>${escapeHtml(note)}</small>` : ""}
    </article>
  `;
}

function modalMiniCard(label, value, note = "") {
  return `
    <article class="modal-mini-card">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
      ${note ? `<small>${escapeHtml(note)}</small>` : ""}
    </article>
  `;
}

function modalSection(title, subtitle, content, className = "") {
  return `
    <section class="modal-section ${className}">
      <div class="modal-section-heading">
        <div>
          <h3>${escapeHtml(title)}</h3>
          ${subtitle ? `<p>${escapeHtml(subtitle)}</p>` : ""}
        </div>
      </div>
      ${content}
    </section>
  `;
}

function modalRank(value) {
  const ranks = [
    "Unrated",
    "Iron 1", "Iron 2", "Iron 3",
    "Bronze 1", "Bronze 2", "Bronze 3",
    "Silver 1", "Silver 2", "Silver 3",
    "Gold 1", "Gold 2", "Gold 3",
    "Platinum 1", "Platinum 2", "Platinum 3",
    "Diamond 1", "Diamond 2", "Diamond 3",
    "Ascendant 1", "Ascendant 2", "Ascendant 3",
    "Immortal 1", "Immortal 2", "Immortal 3",
    "Radiant",
  ];

  const number = Number(value);
  return Number.isFinite(number) && number >= 1 && number <= 25
    ? ranks[number]
    : "N/A";
}

function modalProgress(value, max = 100) {
  const number = Number(value);
  const percentage = Number.isFinite(number) && max > 0
    ? Math.max(0, Math.min(100, (number / max) * 100))
    : 0;

  return `
    <div class="modal-progress">
      <span style="width:${percentage}%"></span>
    </div>
  `;
}

function formatRecord(wins, losses, draws) {
  const record = `${num(wins)}–${num(losses)}`;
  return num(draws) ? `${record}–${num(draws)}` : record;
}

// Convert nested performance rating data into readable metric cards.
function modalRatingCards(ratings) {
  if (!ratings || typeof ratings !== "object") {
    return `<p class="modal-empty">No rating data available for this act.</p>`;
  }

  const cards = Object.entries(ratings).flatMap(([group, metrics]) => {
    if (!metrics || typeof metrics !== "object") return [];

    return Object.entries(metrics).map(([metric, value]) => {
      let displayValue = value;

      // Ratings may be stored as a value -> occurrence-count map.
      if (value && typeof value === "object") {
        const entries = Object.entries(value);
        if (!entries.length) return "";

        const best = entries.sort((a, b) => Number(b[1]) - Number(a[1]))[0];
        displayValue = best[0];
      }

      return `
        <article class="modal-mini-card">
          <span>${escapeHtml(metric.replace(/_/g, " "))}</span>
          <strong>${escapeHtml(String(displayValue ?? "N/A").replace(/_/g, " "))}</strong>
          <small>Most common ${escapeHtml(group)} rating</small>
        </article>
      `;
    });
  }).filter(Boolean);

  return cards.length
    ? `<div class="modal-mini-grid">${cards.join("")}</div>`
    : `<p class="modal-empty">No rating data available for this act.</p>`;
}

function modalGradeCards(grades) {
  const entries = Object.entries(grades || {}).filter(([, count]) => num(count) > 0);
  if (!entries.length) {
    return `<p class="modal-empty">No match grades recorded for this period.</p>`;
  }

  const total = entries.reduce((sum, [, count]) => sum + num(count), 0);
  const cards = entries
    .sort((a, b) => num(b[1]) - num(a[1]))
    .map(([grade, count]) => modalMiniCard(
      grade.replace(/_/g, " "),
      modalNumber(count, 0),
      `${modalNumber((num(count) / total) * 100, 0)}% of graded matches`
    ));

  return `<div class="modal-mini-grid">${cards.join("")}</div>`;
}

function renderMapsTable(maps) {
  const rows = Object.entries(maps || {});
  if (!rows.length) {
    return `<p class="modal-empty">Map results are not recorded for this period.</p>`;
  }

  return `
    <table class="modal-table">
      <thead>
        <tr><th>Map</th><th>Played</th><th>W–L</th><th>Win %</th><th>Round win %</th></tr>
      </thead>
      <tbody>
        ${rows.map(([mapName, m]) => `
          <tr>
            <td>${escapeHtml(mapName)}</td>
            <td>${modalNumber(m.matches, 0)}</td>
            <td>${formatRecord(m.wins, m.losses, m.draws)}</td>
            <td>${modalPercent(m.winrate)}</td>
            <td>${modalPercent(m.round_winrate)}</td>
          </tr>
        `).join("")}
      </tbody>
    </table>
  `;
}

/* ------------------ Accolades ------------------ */

function findAccolade(source, aliases) {
  if (!Array.isArray(source)) return null;

  const targets = new Set(
    aliases.map((key) => key.toLowerCase().replace(/[^a-z0-9]/g, ""))
  );

  return source.find((item) => {
    const type = String(item?.type || "")
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "");

    return targets.has(type);
  }) || null;
}

// best_value units differ by accolade type.
function formatAccoladeBest(type, value) {
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) return null;

  switch (type) {
    case "headshot_percentage":
      // Stored as a fraction (0.43 = 43%).
      return `${modalNumber(number <= 1 ? number * 100 : number, 1)}%`;
    case "damage_per_round":
      return `${modalNumber(number, 1)} ADR`;
    case "kills":
      return `${modalNumber(number, 0)} kills`;
    case "assists":
      return `${modalNumber(number, 0)} assists`;
    case "first_blood":
      return `${modalNumber(number, 0)} first bloods`;
    case "trades":
      return `${modalNumber(number, 0)} trades`;
    case "plants":
      return `${modalNumber(number, 0)} plants`;
    default:
      return modalNumber(number, number % 1 ? 1 : 0);
  }
}

function renderAccoladeGroup(title, subtitle, definitions, source) {
  const items = definitions.map(([label, , aliases]) => {
    const accolade = findAccolade(source, aliases);
    const count = accolade ? Number(accolade.count) : null;
    const best = accolade ? formatAccoladeBest(accolade.type, accolade.best_value) : null;

    const hasCount = Number.isFinite(count);
    const earned = hasCount && count > 0;

    return `
      <article class="accolade-card ${earned ? "earned" : ""}">

        <div class="accolade-copy">
          <span class="accolade-name">${escapeHtml(label)}</span>

          <strong>${hasCount ? modalNumber(count, 0) : "—"}</strong>

          <small>
            ${
              !hasCount
                ? "No data"
                : earned
                  ? "Times earned"
                  : "Not yet earned"
            }
          </small>

          ${best ? `<div class="accolade-best">Best: ${escapeHtml(best)}</div>` : ""}
        </div>
      </article>
    `;
  }).join("");

  return `
    <section class="modal-section">
      <div class="modal-section-heading">
        <div>
          <h3>${escapeHtml(title)}</h3>
          <p>${escapeHtml(subtitle)}</p>
        </div>
      </div>

      <div class="accolade-grid">${items}</div>
    </section>
  `;
}

/* ------------------ Agents ------------------ */

// Wiki filenames that don't match the in-game agent name.
const AGENT_IMAGE_NAMES = {
  "KAY/O": "KAYO",
};

function agentImageUrl(name) {
  const fileName = AGENT_IMAGE_NAMES[name] || name.trim().replace(/\s+/g, "_");
  return `https://wiki.playvalorant.com/en-us/images/${encodeURIComponent(fileName)}_icon.png`;
}

// Agent entries written before per-agent summaries existed only have a few
// flat fields; build what we can from them.
function agentSummary(agent) {
  if (agent?.summary) return agent.summary;

  const kills = num(agent?.kills);
  const deaths = num(agent?.deaths);
  return {
    matches: num(agent?.matches),
    kd: agent?.matches ? roundTo(kills / Math.max(deaths, 1), 2) : null,
    hs_percent: agent?.headshot_percentage ?? null,
    avg_performance_score: agent?.average_performance_score ?? null,
    legacy: true,
  };
}

function bestMap(maps) {
  const entries = Object.entries(maps || {});
  if (!entries.length) return null;

  // Most played; ties broken by win rate.
  const [mapName, m] = entries.sort((a, b) =>
    (b[1].matches - a[1].matches) || (num(b[1].winrate) - num(a[1].winrate))
  )[0];
  return `${mapName} (${formatRecord(m.wins, m.losses, m.draws)})`;
}

function renderAgentCard(name, agent, totalMatches) {
  const s = agentSummary(agent);
  const matches = num(s.matches);
  const pickRate = totalMatches ? (matches / totalMatches) * 100 : null;
  const multikills = s.multikills || {};
  const highlightRounds = num(multikills["3k"]) + num(multikills["4k"]) + num(multikills["5k"]);

  const stat = (label, value) => `
    <div>
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;

  const primary = [
    stat("Win rate", modalPercent(s.winrate)),
    stat("ACS", modalNumber(s.acs, 0)),
    stat("ADR", modalNumber(s.adr, 0)),
    stat("K/D", modalNumber(s.kd, 2)),
    stat("KAST", modalPercent(s.kast, 0)),
    stat("HS%", modalPercent(s.hs_percent)),
    stat("DD Δ/round", s.dd_delta == null ? "N/A" : `${s.dd_delta > 0 ? "+" : ""}${modalNumber(s.dd_delta, 0)}`),
    stat("First bloods", s.first_bloods == null ? "N/A" : `${s.first_bloods}–${num(s.first_deaths)}`),
    stat("Performance", modalNumber(s.avg_performance_score, 0)),
  ].join("");

  const secondary = s.legacy ? "" : `
    <div class="agent-stats agent-stats-secondary">
      ${stat("3K+ rounds", modalNumber(highlightRounds, 0))}
      ${stat("Aces", modalNumber(multikills["5k"], 0))}
      ${stat("Clutches", modalNumber(s.clutches, 0))}
      ${stat("Plants / defuses", `${num(s.plants)} / ${num(s.defuses)}`)}
      ${stat("Ults / match", modalNumber(s.ultimates_per_match, 1))}
      ${stat("Trade kills", modalNumber(s.trade_kills, 0))}
    </div>
  `;

  const map = s.legacy ? null : bestMap(s.maps);
  const footer = s.legacy
    ? "Detailed agent stats appear after the next data refresh"
    : `<span>${formatTime(s.time_played_ms)} played</span>${map ? `<span>Most played map: ${escapeHtml(map)}</span>` : ""}`;

  return `
    <article class="agent-card">
      <div class="agent-card-top">
        <img
          class="agent-portrait"
          src="${escapeHtml(agentImageUrl(name))}"
          alt="${escapeHtml(name)}"
          loading="lazy"
          onerror="this.style.visibility='hidden'"
        />

        <div class="agent-card-title">
          <h4>${escapeHtml(name)}</h4>
        </div>

        <span class="agent-match-count">
          ${s.legacy ? "" : `<b>${formatRecord(s.wins, s.losses, s.draws)}</b>`}
          ${matches} ${matches === 1 ? "match" : "matches"}
        </span>
      </div>

      ${pickRate == null ? "" : `
        <div class="agent-pick">
          <div class="agent-pick-label">
            <span>Pick rate</span>
            <strong>${modalNumber(pickRate, 0)}%</strong>
          </div>
          ${modalProgress(pickRate)}
        </div>
      `}

      <div class="agent-stats">${primary}</div>
      ${secondary}

      <div class="agent-time">${s.legacy ? `<span>${footer}</span>` : footer}</div>
    </article>
  `;
}

function renderAgentPool(agents, totalMatches) {
  if (!agents.length) {
    return `<p class="modal-empty">Agent-specific stats are not available for this period.</p>`;
  }

  const withSummary = agents
    .map(([name, agent]) => ({ name, s: agentSummary(agent) }))
    .filter((item) => !item.s.legacy);

  // Leaders need at least 2 matches so a single good game doesn't top the list.
  const eligible = withSummary.filter((item) => item.s.matches >= 2);
  const leader = (key) => eligible
    .filter((item) => item.s[key] != null)
    .sort((a, b) => b.s[key] - a.s[key])[0];

  const mostPlayed = agents[0];
  const bestAcs = leader("acs");
  const bestWin = leader("winrate");
  const bestKast = leader("kast");

  const leaders = withSummary.length ? `
    <div class="modal-stats-grid">
      ${modalStat("Most played", mostPlayed[0], `${num(agentSummary(mostPlayed[1]).matches)} matches`)}
      ${modalStat("Best ACS", bestAcs ? bestAcs.name : "N/A", bestAcs ? `${modalNumber(bestAcs.s.acs, 0)} ACS, min 2 matches` : "Needs 2+ matches on an agent")}
      ${modalStat("Best win rate", bestWin ? bestWin.name : "N/A", bestWin ? `${modalPercent(bestWin.s.winrate, 0)}, ${formatRecord(bestWin.s.wins, bestWin.s.losses, bestWin.s.draws)}` : "Needs 2+ matches on an agent")}
      ${modalStat("Best KAST", bestKast ? bestKast.name : "N/A", bestKast ? `${modalPercent(bestKast.s.kast, 0)}, min 2 matches` : "Needs 2+ matches on an agent")}
    </div>
  ` : "";

  return `
    ${leaders}
    <div class="agent-grid">
      ${agents.map(([name, agent]) => renderAgentCard(name, agent, totalMatches)).join("")}
    </div>
  `;
}

/* ------------------ Modal ------------------ */

function ensureCardModal() {
  let modal = document.getElementById("cardModal");
  if (modal) return modal;

  modal = document.createElement("div");
  modal.id = "cardModal";
  modal.className = "card-modal";

  modal.innerHTML = `
    <div class="card-modal-content" role="dialog" aria-modal="true" aria-labelledby="cardModalName">
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


function playerPageUrl(player, act) {
  return `player.html?id=${encodeURIComponent(player.id)}&act=${encodeURIComponent(act)}`;
}

function openCardModal(player, act = currentAct) {
  const modal = ensureCardModal();
  const title = modal.querySelector("#cardModalTitle");
  const body = modal.querySelector("#cardModalBody");
  const openLink = modal.querySelector("#cardModalOpenLink");
  const pageLink = modal.querySelector("#cardModalPageLink");

  title.textContent = act === "overall" ? "Overall, all acts combined" : getActLabel(act);
  modal.querySelector(".card-modal-content").dataset.tier = rankTier(player.rank);
  body.innerHTML = renderPlayerProfile(player, act);
  bindProfileTabs(body);

  openLink.href = trackerProfileUrl(player.riot_id || player.id);
  pageLink.href = playerPageUrl(player, act);
  modal.classList.add("open");
  body.scrollTop = 0;
}

// Full profile (hero, tabs, panels) used by both the popup and player.html.
function renderPlayerProfile(player, act) {
  const currentActLabel = getActLabel(act);
  const isOverall = act === "overall";
  const score = getDisplayedValoStatScore(player, act);

  const wins = Number(player.wins) || 0;
  const matches = Number(player.matches) || 0;
  const losses = Math.max(0, matches - wins);
  const winRate = matches ? (wins / matches) * 100 : 0;
  const performanceMatches = Number(player.performance_score_matches) || 0;
  const averagePerformance = performanceMatches
    ? modalNumber(player.avg_performance_score, 1)
    : "N/A";

  // Detailed stats (summary / agents / maps) are only recorded from the
  // current fetcher onwards. In Overall, say how many acts they cover.
  const summary = player.summary || null;
  const detailedActs = Array.isArray(player.detailedActs) ? player.detailedActs : null;
  const coverage = isOverall && detailedActs && detailedActs.length < (player.actCount || 1)
    ? (detailedActs.length
        ? `Only ${detailedActs.join(", ")} has detailed tracking`
        : "No act in this period has detailed tracking")
    : "";
  const notRecorded = `<p class="modal-empty">Not recorded for this period. Detailed tracking started in V26: A6.</p>`;


  // The API's breakdown values are already per-round rates for each match;
  // these are their averages across matches.
  const performanceBreakdown = player.performance_breakdown_averages || {};
  const performanceBreakdownLabels = {
    damage: "Damage",
    trades: "Trades",
    assists: "Assists",
    utility_usage: "Utility usage",
    plants: "Spike plants",
    defuses: "Defuses",
    adjusted_kills: "Adjusted kills",
    adjusted_deaths: "Adjusted deaths",
  };

  const breakdownCards = Object.entries(performanceBreakdown)
    .filter(([, value]) => value != null)
    .map(([key, value]) => modalMiniCard(
      performanceBreakdownLabels[key] || key.replace(/_/g, " "),
      modalNumber(value, key === "damage" ? 1 : 2),
      "Per round, averaged over matches"
    )).join("");

  const agents = Object.entries(player.agents || {})
    .sort((a, b) => (b[1].matches || 0) - (a[1].matches || 0));
  const agentMatchesTotal = summary?.matches ?? trackedMatches(player);

  const rankEnemy = player.enemy_rank_average_value;
  const rankLobby = player.lobby_rank_average_value;

  const accoladesSource = player.accolades_seasonal || [];

  const coreAccolades = [
    ["MVP", "✦", ["mvp"]],
    ["Top Frag", "★", ["top_frag"]],
    ["Aces", "✹", ["aces", "ace"]],
    ["Clutches", "◈", ["clutches"]],
    ["Kills", "☠", ["kills"]],
    ["Headshots", "◎", ["headshot_percentage", "headshots"]],
    ["First Bloods", "⚡", ["first_blood"]],
  ];

  const performanceAccolades = [
    ["Masterful", "◆", ["distinction"]],
    ["Damage", "◉", ["damage_per_round"]],
    ["Trades", "⇄", ["trades"]],
    ["Assists", "✋", ["assists"]],
    ["Spike Plants", "⬡", ["plants"]],
  ];

  const multikills = summary?.multikills || {};
  const casts = summary?.ability_casts_per_round || {};

  const impactSection = summary ? `
    <div class="modal-mini-grid">
      ${modalMiniCard("Opening duels won", modalPercent(summary.opening_duel_winrate, 0), `${num(summary.first_bloods)} first bloods, ${num(summary.first_deaths)} first deaths`)}
      ${modalMiniCard("Trade kills", modalNumber(summary.trade_kills, 0), "Avenged a teammate within 5s")}
      ${modalMiniCard("Deaths traded", modalNumber(summary.traded_deaths, 0), `of ${modalNumber(player.deaths_total, 0)} deaths`)}
      ${modalMiniCard("Multi-kills", `${num(multikills["2k"])} / ${num(multikills["3k"])} / ${num(multikills["4k"])}`, "2K / 3K / 4K rounds")}
      ${modalMiniCard("Aces", modalNumber(multikills["5k"], 0), "5+ kills in a round")}
      ${modalMiniCard("Clutches", modalNumber(summary.clutches, 0), "Last player alive, round won")}
      ${modalMiniCard("Match MVPs", modalNumber(summary.match_mvps, 0), `${num(summary.team_mvps)} team MVPs`)}
      ${modalMiniCard("Spike plants", modalNumber(summary.plants, 0), `${num(summary.defuses)} defuses`)}
      ${modalMiniCard("Round win rate", modalPercent(summary.round_winrate), `${modalNumber(summary.rounds, 0)} rounds`)}
    </div>
  ` : notRecorded;

  const utilitySection = summary ? `
    <div class="modal-mini-grid">
      ${modalMiniCard("Grenade slot", modalNumber(casts.grenade, 2), "Casts per round")}
      ${modalMiniCard("Ability 1 slot", modalNumber(casts.ability_1, 2), "Casts per round")}
      ${modalMiniCard("Ability 2 slot", modalNumber(casts.ability_2, 2), "Casts per round")}
      ${modalMiniCard("Ultimates", modalNumber(summary.ultimates_per_match, 1), "Per match")}
      ${modalMiniCard("Avg spend", modalNumber(summary.avg_spent_per_round, 0), "Credits per round")}
      ${modalMiniCard("Avg loadout", modalNumber(summary.avg_loadout_per_round, 0), "Credits per round")}
    </div>
  ` : notRecorded;

  return `
    <section class="modal-hero">
      <div class="modal-hero-art">
        <img src="${escapeHtml(player.banner || "")}" alt="" />
      </div>

      <div class="modal-hero-copy">
        <h3 id="cardModalName" class="modal-name">${escapeHtml(player.id)}</h3>
        <p class="modal-identity">${escapeHtml(player.riot_id || player.id)}</p>

        <dl class="modal-hero-facts">
          <div><dt>Rank</dt><dd>${escapeHtml(player.rank || "Unrated")}<small>${modalNumber(player.rr, 0)} RR</small></dd></div>
          <div><dt>Level</dt><dd>${escapeHtml(player.level ?? "—")}</dd></div>
          <div><dt>Record</dt><dd>${wins}W ${losses}L</dd></div>
        </dl>

        <div class="modal-hero-winbar">
          <div><span>Win rate</span><strong>${modalNumber(winRate, 1)}%</strong></div>
          ${modalProgress(winRate)}
        </div>
      </div>

      <div class="modal-score-panel">
        <span class="modal-score-label">ValoStat score</span>
        <strong class="modal-score-value">${formatScore(score)}<small>/1000</small></strong>
        ${scoreMeter(score)}
        <span class="modal-score-sub">${escapeHtml(isOverall ? "Average of each act's score" : currentActLabel)}</span>
      </div>
    </section>

    <nav class="modal-tabs" role="tablist" aria-label="Player statistics">
      <button class="modal-tab active" type="button" role="tab" aria-selected="true" data-tab="overview">Overview</button>
      <button class="modal-tab" type="button" role="tab" aria-selected="false" data-tab="performance">Performance</button>
      <button class="modal-tab" type="button" role="tab" aria-selected="false" data-tab="agents">Agents</button>
      <button class="modal-tab" type="button" role="tab" aria-selected="false" data-tab="matchmaking">Matchmaking</button>
      <button class="modal-tab" type="button" role="tab" aria-selected="false" data-tab="accolades">Accolades</button>
    </nav>

    <div class="modal-tab-panel active" data-panel="overview" role="tabpanel">
      <div class="modal-stats-grid">
        ${modalStat("Win rate", `${modalNumber(winRate, 1)}%`, `${wins} wins, ${losses} losses`)}
        ${modalStat("Avg ACS", modalNumber(player.avg_acs), `${modalNumber(player.rounds_total, 0)} rounds`)}
        ${modalStat("ADR", summary ? modalNumber(summary.adr) : "N/A", "Damage per round")}
        ${modalStat("K/D", modalNumber(player.kd, 2), `${modalNumber(player.kills_total, 0)} kills / ${modalNumber(player.deaths_total, 0)} deaths`)}
        ${modalStat("KA/D", modalNumber(player.kad, 2), `${modalNumber(player.assists_total, 0)} assists`)}
        ${modalStat("KAST", `${modalNumber(player.kast)}%`, "Rounds with kill, assist, survival or trade")}
        ${modalStat("Damage delta", modalNumber(player.dd_delta), "Per round")}
        ${modalStat("Avg performance", averagePerformance, `${performanceMatches} rated matches`)}
      </div>

      ${modalSection("Career snapshot", "Aggregated statistics for the selected period", `
        <div class="modal-detail-grid">
          <div><span>Matches</span><strong>${modalNumber(matches, 0)}</strong></div>
          <div><span>Wins</span><strong>${modalNumber(wins, 0)}</strong></div>
          <div><span>Playtime</span><strong>${escapeHtml(formatTime(player.time_total))}</strong></div>
          <div><span>Rounds</span><strong>${modalNumber(player.rounds_total, 0)}</strong></div>
          <div><span>Kills / match</span><strong>${modalNumber(perMatch(player, player.kills_total), 1)}</strong></div>
          <div><span>Deaths / match</span><strong>${modalNumber(perMatch(player, player.deaths_total), 1)}</strong></div>
          <div><span>Assists / match</span><strong>${modalNumber(perMatch(player, player.assists_total), 1)}</strong></div>
          <div><span>Acts played</span><strong>${escapeHtml(player.actsPlayed || currentActLabel)}</strong></div>
        </div>
        ${trackedMatches(player) < matches
          ? `<p class="modal-footnote">Per-match averages use the ${trackedMatches(player)} matches with full data, out of ${matches} played.</p>`
          : ""}
      `)}

      ${modalSection("Maps", coverage || "Results by map", summary ? renderMapsTable(summary.maps) : notRecorded)}
    </div>

    <div class="modal-tab-panel" data-panel="performance" role="tabpanel" hidden>
      <div class="modal-stats-grid">
        ${modalStat("Avg performance score", averagePerformance, `${performanceMatches} matches with a score`)}
        ${modalStat("Avg ACS", modalNumber(player.avg_acs), "Average combat score")}
        ${modalStat("Damage delta / round", modalNumber(player.dd_delta), "Damage dealt minus received")}
        ${modalStat("Headshot rate", player.hs_percent == null ? "N/A" : `${modalNumber(player.hs_percent)}%`, "Across recorded shots")}
      </div>

      ${modalSection("Impact", coverage || "Opening duels, trades and round-winning plays", impactSection)}

      ${modalSection("Performance breakdown", "Per-round values reported by the match API, averaged across matches", `
        ${breakdownCards
          ? `<div class="modal-mini-grid">${breakdownCards}</div>`
          : `<p class="modal-empty">No performance breakdown is available for this period.</p>`}
      `)}

      ${modalSection("Match grades", "How often each grade was given by the API", modalGradeCards(player.performance_grades))}

      ${modalSection("Combat ratings", "Most common rating for each metric", `
        ${modalRatingCards(player.performance_ratings)}
      `)}

      ${modalSection("Utility & economy", coverage || "Ability usage and spending", utilitySection)}
    </div>

    <div class="modal-tab-panel" data-panel="agents" role="tabpanel" hidden>
      ${modalSection("Agent pool", coverage || `${agents.length} agents with recorded stats`, renderAgentPool(agents, agentMatchesTotal))}
    </div>

    <div class="modal-tab-panel" data-panel="matchmaking" role="tabpanel" hidden>
      <div class="modal-stats-grid">
        ${modalStat("Current rank", player.rank || "Unrated", `${modalNumber(player.rr, 0)} RR`)}
        ${modalStat("Average enemy rank", modalRank(rankEnemy == null ? null : Math.round(rankEnemy)), rankEnemy == null ? "Not enough rank data" : `Rank value ${modalNumber(rankEnemy, 2)} / 25`)}
        ${modalStat("Average lobby rank", modalRank(rankLobby == null ? null : Math.round(rankLobby)), rankLobby == null ? "Not enough rank data" : `Rank value ${modalNumber(rankLobby, 2)} / 25`)}
        ${modalStat("Matches counted", modalNumber(player.enemy_rank_matches, 0), "For enemy rank average")}
      </div>
      ${modalSection("How to read this", "Rank values use an ordered scale from Iron 1 to Radiant", `
        <p class="modal-description">Average enemy rank estimates the average rank of opponents in matches where rank data was available. Average lobby rank includes all players with a known tier. These are averages across matches, not your current rank.</p>
      `)}
    </div>

    <div class="modal-tab-panel" data-panel="accolades" role="tabpanel" hidden>
      ${renderAccoladeGroup("Core", "Standout match achievements", coreAccolades, accoladesSource)}
      ${renderAccoladeGroup("Performance", "Combat and team-play achievements", performanceAccolades, accoladesSource)}
      <p class="modal-footnote">A dash means the accolade count was not found in the saved API response; it does not mean zero.${isOverall ? " Overall adds up counts across acts and keeps the best value." : ""}</p>
    </div>
  `;

}

function bindProfileTabs(root) {
  root.querySelectorAll(".modal-tab").forEach((tab) => {
    tab.addEventListener("click", () => {
      const selected = tab.dataset.tab;

      root.querySelectorAll(".modal-tab").forEach((item) => {
        const active = item === tab;
        item.classList.toggle("active", active);
        item.setAttribute("aria-selected", String(active));
      });

      root.querySelectorAll(".modal-tab-panel").forEach((panel) => {
        const active = panel.dataset.panel === selected;
        panel.classList.toggle("active", active);
        panel.hidden = !active;
      });
    });
  });
}


/* ------------------ Act Navigation ------------------ */

// Buttons are built from acts.json and always carry act codes ("e11a6"),
// so there is a single name for each act.
function buildActNav() {
  const nav = document.getElementById("actNav");
  if (!nav) return;

  const buttons = [{ code: "overall", label: "Overall" }, ...actsConfig.acts];
  nav.innerHTML = buttons.map((act) => `
    <button class="nav-btn${act.code === currentAct ? " active" : ""}" type="button" data-act="${escapeHtml(act.code)}" aria-pressed="${act.code === currentAct}">
      ${escapeHtml(act.label)}
    </button>
  `).join("");

  nav.addEventListener("click", (event) => {
    const button = event.target.closest(".nav-btn");
    if (button) setCurrentAct(button.dataset.act);
  });
}

function setCurrentAct(act) {
  if (act === currentAct) return;

  currentAct = act;
  currentActData = null;

  document.querySelectorAll("#actNav .nav-btn").forEach((button) => {
    const active = button.dataset.act === act;
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
  });

  onActChange(act);
}

async function onActChange(act) {
  resetComparison();
  showDiff = false;

  const toggleDiff = document.getElementById("toggleDiff");
  if (toggleDiff) toggleDiff.checked = false;

  const data = await renderCards(act);
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

// Score for a single act. Returns null when the player has no matches, so it
// can be skipped when averaging and shown as a dash.
function valoStatScore(player) {
  if (!player || !(Number(player.matches) > 0)) return null;

  const hasPerformanceScore =
    (player.performance_score_matches || 0) > 0 &&
    player.avg_performance_score != null;

  const acs = sigmoidNormalize(player.avg_acs, 200, 65);
  const kast = clamp((player.kast || 0) / 100, 0, 1);
  const kad = sigmoidNormalize(player.kad, 1.2, 0.28);
  const dd = sigmoidNormalize(player.dd_delta, 0, 30);
  const win = clamp((player.wins || 0) / player.matches, 0, 1);

  let score;

  if (hasPerformanceScore) {
    const performance = sigmoidNormalize(
      player.avg_performance_score,
      200,
      60
    );

    score =
      0.40 * performance +
      0.20 * acs +
      0.15 * kast +
      0.10 * kad +
      0.10 * dd +
      0.05 * win;
  } else {
    // Legacy distribution for acts without performance-score data.
    score =
      0.30 * acs +
      0.20 * kast +
      0.15 * kad +
      0.25 * dd +
      0.10 * win;
  }

  return clamp(Math.round(score * 1000), 10, 1000);
}

function formatScore(score) {
  return score == null ? "—" : String(score);
}

// Ten slanted segments of 100 points each; partially filled segments show the remainder.
function scoreMeter(score) {
  const value = score == null ? 0 : Number(score) || 0;
  const pips = Array.from({ length: 10 }, (_, index) => {
    const fill = clamp((value - index * 100) / 100, 0, 1);
    return `<span class="pip" style="--fill:${roundTo(fill, 3)}"></span>`;
  }).join("");

  return `<span class="score-pips" aria-hidden="true">${pips}</span>`;
}

// The one score used by cards, sorting, the modal and comparisons.
function getDisplayedValoStatScore(player, act) {
  if (act === "overall") {
    return Number.isFinite(player.valostat_score) ? player.valostat_score : null;
  }

  return valoStatScore(player);
}


function formatTime(ms) {
  const totalSeconds = Math.floor((Number(ms) || 0) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  let result = "";

  if (hours > 0) result += `${hours}h `;
  if (minutes > 0) result += `${minutes}m `;
  // Seconds only matter for short durations.
  if (hours === 0 && (seconds > 0 || result === "")) result += `${seconds}s`;

  return result.trim() || "0m";
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
  lastLoadedAt = Date.now();
  overallCache = null;
  currentActData = null;
  actFileCache.clear();

  let previous = [];
  try {
    previous = previousResponse && previousResponse.ok ? await previousResponse.json() : [];
  } catch (error) {
    console.warn("Unable to read stats_prev.json", error);
  }

  prev = computeDiff(cache, previous);

  const data = await renderCards(currentAct);
  populateDropdowns(data);
  lastUpdate(current);
}

// Stats refresh every few hours. If the page has been left open, reload the
// data when the tab is shown again instead of showing stale numbers.
const STALE_AFTER_MS = 15 * 60 * 1000;

function refreshWhenStale() {
  if (document.visibilityState !== "visible") return;
  if (Date.now() - lastLoadedAt < STALE_AFTER_MS) return;

  const modal = document.getElementById("cardModal");
  if (modal?.classList.contains("open")) return;

  loadStats().catch((error) => console.warn("Refreshing stats failed", error));
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

    const newScore = valoStatScore(player);
    const oldScore = valoStatScore(old);
    const scoreChanged = newScore !== oldScore;

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
        ? `${formatScore(oldScore)} → ${formatScore(newScore)}`
        : formatScore(newScore),
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
  if (diffMinutes < 1) {
    text += "just now";
  } else {
    if (hours > 0) text += `${hours}h `;
    if (minutes > 0) text += `${minutes}m `;
    text += "ago";
  }

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

/* ---------- Overall: combine acts ---------- */

// Totals that are simply summed across acts.
const OVERALL_SUM_KEYS = [
  "matches", "wins", "rounds_total", "acs_total",
  "kills_total", "deaths_total", "assists_total",
  "kast_rounds_total", "damage_delta_total", "time_total",
  "performance_score_total", "performance_score_matches",
  "enemy_rank_sum", "enemy_rank_matches",
  "lobby_rank_sum", "lobby_rank_matches",
  "headshots_total", "bodyshots_total", "legshots_total",
];

// entries: [{ player, label }] for one player, newest act first.
function combinePlayerActs(entries) {
  const base = entries[0].player;
  const sums = {};
  OVERALL_SUM_KEYS.forEach((key) => {
    sums[key] = entries.reduce((total, entry) => total + num(entry.player[key]), 0);
  });

  const rounds = sums.rounds_total;
  const deaths = sums.deaths_total;
  const shots = sums.headshots_total + sums.bodyshots_total + sums.legshots_total;

  // Per-act scores, each with the formula that suits that act's data.
  const actScores = entries.map((entry) => ({
    label: entry.label,
    score: valoStatScore(entry.player),
  }));
  const scored = actScores.filter((item) => item.score != null);

  // Detailed stats only exist for acts fetched with the newer script.
  const detailed = entries.filter((entry) => entry.player.totals);
  let totals = null;
  let summary = null;
  const agentTotals = {};

  if (detailed.length) {
    totals = emptyTotals();
    detailed.forEach((entry) => {
      mergeTotals(totals, entry.player.totals);
      Object.entries(entry.player.agents || {}).forEach(([name, agent]) => {
        if (!agent?.totals) return;
        mergeTotals(agentTotals[name] || (agentTotals[name] = emptyTotals()), agent.totals);
      });
    });
    summary = deriveSummary(totals);
  }

  const agents = {};
  Object.entries(agentTotals)
    .sort((a, b) => b[1].matches - a[1].matches)
    .forEach(([name, agentTotal]) => { agents[name] = buildAgentEntry(agentTotal); });

  const breakdownTotals = {};
  PERFORMANCE_BREAKDOWN_KEYS.forEach((key) => {
    breakdownTotals[key] = entries.reduce(
      (total, entry) => total + num(entry.player.performance_breakdown_totals?.[key]),
      0
    );
  });
  const breakdownAverages = {};
  PERFORMANCE_BREAKDOWN_KEYS.forEach((key) => {
    breakdownAverages[key] = ratio(breakdownTotals[key], sums.performance_score_matches, 3);
  });

  const grades = {};
  const ratings = {};
  entries.forEach((entry) => {
    mergeCounts(grades, entry.player.performance_grades);
    mergeRatings(ratings, entry.player.performance_ratings);
  });

  const accoladeLists = entries
    .map((entry) => entry.player.accolades_seasonal)
    .filter(Array.isArray);

  return {
    // Identity, rank and level come from the newest act the player appears in.
    id: base.id,
    riot_id: base.riot_id,
    name: base.name,
    puuid: base.puuid,
    banner: base.banner,
    level: base.level,
    rank: base.rank,
    rr: base.rr,
    elo: base.elo,

    ...sums,
    matches_tracked: entries.reduce((total, entry) => total + trackedMatches(entry.player), 0),
    winrate: sums.matches ? roundTo((sums.wins / sums.matches) * 100, 1) : 0,
    avg_acs: rounds ? sums.acs_total / rounds : 0,
    kd: deaths ? sums.kills_total / deaths : sums.kills_total,
    kad: deaths ? (sums.kills_total + sums.assists_total) / deaths : sums.kills_total + sums.assists_total,
    kast: rounds ? (sums.kast_rounds_total / rounds) * 100 : 0,
    dd_delta: rounds ? sums.damage_delta_total / rounds : 0,
    hs_percent: shots ? roundTo((sums.headshots_total / shots) * 100, 1) : null,
    avg_performance_score: sums.performance_score_matches
      ? sums.performance_score_total / sums.performance_score_matches
      : null,
    enemy_rank_average_value: sums.enemy_rank_matches
      ? sums.enemy_rank_sum / sums.enemy_rank_matches
      : null,
    lobby_rank_average_value: sums.lobby_rank_matches
      ? sums.lobby_rank_sum / sums.lobby_rank_matches
      : null,

    performance_breakdown_totals: breakdownTotals,
    performance_breakdown_averages: breakdownAverages,
    performance_grades: grades,
    performance_ratings: ratings,
    accolades_seasonal: accoladeLists.length ? mergeAccolades(accoladeLists) : [],

    totals,
    summary,
    agents,

    actCount: entries.length,
    actsPlayed: entries.map((entry) => entry.label).join(", "),
    detailedActs: detailed.map((entry) => entry.label),
    actScores,
    // Equal-weighted mean of per-act scores; acts with no matches are skipped.
    valostat_score: scored.length
      ? Math.round(scored.reduce((total, item) => total + item.score, 0) / scored.length)
      : null,
  };
}

/* ---------- Load Act Data ---------- */

// Archived act files never change, so each is fetched once per page load.
async function fetchActFile(code) {
  if (!actFileCache.has(code)) {
    actFileCache.set(code, fetch(`data/${code}.json`)
      .then((response) => (response.ok ? response.json() : null))
      .catch((error) => {
        console.error(`Error loading act data ${code}:`, error);
        return null;
      }));
  }
  return actFileCache.get(code);
}

async function loadActData(act) {
  if (isDefaultActCode(act)) {
    return cache;
  }

  if (act === "overall") {
    const entriesById = new Map();

    const addEntry = (player, label) => {
      if (!player?.id) return;
      if (!entriesById.has(player.id)) entriesById.set(player.id, []);
      entriesById.get(player.id).push({ player, label });
    };

    cache.forEach((player) => addEntry(player, getActLabel(actsConfig.current)));

    // acts.json lists acts newest first, so each player's first entry is
    // their most recent act.
    const archived = actsConfig.acts.filter((item) => !isDefaultActCode(item.code));
    const files = await Promise.all(archived.map((item) => fetchActFile(item.code)));
    files.forEach((actData, index) => {
      if (!Array.isArray(actData)) return;
      actData.forEach((player) => addEntry(player, archived[index].label));
    });

    return [...entriesById.values()].map(combinePlayerActs);
  }

  const actData = await fetchActFile(act);
  return Array.isArray(actData) ? actData : [];
}


// Rank tier keyword ("Gold 2" -> "gold") used for the colour of cards and the popup.
const RANK_TIERS = ["iron", "bronze", "silver", "gold", "platinum", "diamond", "ascendant", "immortal", "radiant"];

function rankTier(rank) {
  const tier = String(rank || "").trim().split(/\s+/)[0].toLowerCase();
  return RANK_TIERS.includes(tier) ? tier : "unrated";
}

function cardStat(label, value, className = "") {
  return `
    <div${className ? ` class="${className}"` : ""}>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
    </div>
  `;
}

function renderPlayerCard(player, view) {
  return `
    <article class="card${view.isDiff ? " diff-highlight" : ""}" data-tier="${rankTier(player.rank)}" data-player-id="${escapeHtml(player.id)}" tabindex="0" aria-label="${escapeHtml(player.id)}, open full stats">
      <div class="card-head">
        <img src="${escapeHtml(player.banner || "")}" class="banner" alt="" loading="lazy" />
        <div class="card-identity">
          <h3>
            <a href="${trackerProfileUrl(player.riot_id)}" target="_blank" rel="noopener noreferrer" class="player-link" tabindex="-1">
              ${escapeHtml(player.id)}
            </a>
          </h3>
          <p class="riot-id">${escapeHtml(player.riot_id)}</p>
        </div>
      </div>

      <div class="card-rank">
        <strong>${escapeHtml(view.rank || "Unrated")}</strong>
        <span>${escapeHtml(view.rr ?? 0)} RR</span>
      </div>

      <dl class="card-stats">
        ${cardStat("Level", view.level ?? "—")}
        ${cardStat("Wins", view.wins)}
        ${cardStat("Win rate", view.winrate)}
        ${cardStat("Playtime", view.time)}
        ${player.actCount ? cardStat("Acts counted", player.actCount) : ""}
        ${view.focus ? cardStat(view.focus[0], view.focus[1], "card-stat-focus") : ""}
      </dl>

      <div class="score">
        <span class="score-value">${escapeHtml(view.scoreText)}</span>
        ${scoreMeter(view.score)}
        <span class="score-label">ValoStat score</span>
      </div>
    </article>
  `;
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

  if (act === "overall") {
    overallCache = displayData;
  } else if (!isDefaultActCode(act)) {
    currentActData = displayData;
  }

  const sortType = document.getElementById("sortSelect").value;

  // Higher first; players without a value always go last.
  const byValue = (getValue) => (a, b) => {
    const va = getValue(a);
    const vb = getValue(b);
    const aMissing = va == null || !Number.isFinite(va);
    const bMissing = vb == null || !Number.isFinite(vb);
    if (aMissing || bMissing) return aMissing - bMissing;
    return vb - va;
  };

  const comparators = {
    score: byValue((p) => getDisplayedValoStatScore(p, act)),
    rank: byValue((p) => p.elo || 0),
    level: byValue((p) => p.level || 0),
    winPercentage: byValue((p) => p.winrate || 0),
    matchesPlayed: byValue((p) => p.matches || 0),
    kills: byValue((p) => perMatch(p, p.kills_total)),
    // Fewer deaths per game ranks higher.
    deaths: byValue((p) => {
      const value = perMatch(p, p.deaths_total);
      return value == null ? null : -value;
    }),
    assists: byValue((p) => perMatch(p, p.assists_total)),
    acs: byValue((p) => p.avg_acs || 0),
    kd: byValue((p) => p.kd || 0),
    kad: byValue((p) => p.kad || 0),
    kast: byValue((p) => p.kast || 0),
    dd: byValue((p) => p.dd_delta || 0),
    time: byValue((p) => p.time_total || 0),
  };

  if (comparators[sortType]) {
    displayData.sort(comparators[sortType]);
  }

  profiles.innerHTML = "";

  if (showDiff && prev.length > 0) {
    const hasDiff = prev.some((player) => player.diff);

    if (!hasDiff) {
      profiles.innerHTML = "<p class='no-changes'>No changes since last update.</p>";
      return displayData;
    }
  }

  const perMatchText = (player, total) => {
    const value = perMatch(player, total);
    return value == null ? "N/A" : Math.trunc(value * 100) / 100;
  };

  // The extra stat shown on each card follows the sort choice.
  const focusStat = (player) => {
    switch (sortType) {
      case "kills": return ["Kills per match", perMatchText(player, player.kills_total)];
      case "deaths": return ["Deaths per match", perMatchText(player, player.deaths_total)];
      case "assists": return ["Assists per match", perMatchText(player, player.assists_total)];
      case "acs": return ["Average ACS", formatStat(player.avg_acs || 0)];
      case "kd": return ["K/D", formatStat(player.kd || 0)];
      case "kad": return ["KA/D", formatStat(player.kad || 0)];
      case "kast": return ["KAST", `${formatStat(player.kast || 0)}%`];
      case "dd": return ["Damage delta per round", formatStat(player.dd_delta || 0)];
      default: return null;
    }
  };

  const cards = [];

  displayData.forEach((player) => {
    const playerKey = getPlayerMatchKey(player);
    const playerDiff = prev.find(
      (item) => getPlayerMatchKey(item) === playerKey
    );

    if (showDiff && playerDiff && !playerDiff.diff) return;

    const useDiff = Boolean(showDiff && playerDiff && playerDiff.diff);
    const score = getDisplayedValoStatScore(player, act);

    cards.push(renderPlayerCard(player, {
      isDiff: useDiff,
      rank: useDiff ? playerDiff.rank : player.rank,
      rr: useDiff ? playerDiff.rr : player.rr,
      level: useDiff ? playerDiff.level : player.level,
      wins: useDiff ? `${playerDiff.wins}/${playerDiff.matches}` : `${player.wins}/${player.matches}`,
      winrate: useDiff ? playerDiff.winrate : `${player.winrate}%`,
      time: useDiff ? playerDiff.time_total : formatTime(player.time_total),
      scoreText: useDiff ? playerDiff.score : formatScore(score),
      score,
      focus: focusStat(player),
    }));
  });

  profiles.innerHTML = cards.join("");

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

function onCompareClick() {
  const data = getComparisonData();
  if (!data || data.length === 0) return;

  const a = data.find((player) => player.id === selectA.value);
  const b = data.find((player) => player.id === selectB.value);

  if (!a || !b || a.id === b.id) return;

  renderComparison(a, b);
}

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

  // Nothing to compare against when one side has no value.
  if (compareA == null || compareB == null) {
    return `<td>${displayA}</td><td>${displayB}</td>`;
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
        ${statRow(getDisplayedValoStatScore(a, currentAct), getDisplayedValoStatScore(b, currentAct))}
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

/* ------------------ Player page (player.html) ------------------ */

async function initPlayerPage() {
  const root = document.getElementById("playerPageRoot");
  const params = new URLSearchParams(window.location.search);
  const id = params.get("id");
  const act = params.get("act") || actsConfig.current;

  const showMissing = (message) => {
    root.innerHTML = `
      <section class="player-page-empty">
        <h1>Player not found</h1>
        <p>${escapeHtml(message)}</p>
        <a class="modal-link-btn" href="index.html">Back to all players</a>
      </section>
    `;
  };

  if (!id) {
    showMissing("This link doesn't say which player to show.");
    return;
  }

  try {
    const response = await fetch("stats.json?ts=" + Date.now());
    cache = await response.json();
  } catch (error) {
    cache = [];
  }

  const data = await loadActData(act);
  const player = data.find((item) => item.id === id);

  if (!player) {
    showMissing(`No stats for ${id} in ${getActLabel(act)}.`);
    return;
  }

  document.title = `${player.id}, ${getActLabel(act)} | ValoStat`;
  root.innerHTML = `
    <nav class="player-page-topbar">
      <a class="modal-link-btn modal-page-btn" href="index.html">All players</a>
      <span class="player-page-act">${escapeHtml(act === "overall" ? "Overall, all acts combined" : getActLabel(act))}</span>
      <a class="modal-link-btn" target="_blank" rel="noopener noreferrer" href="${trackerProfileUrl(player.riot_id || player.id)}">Tracker</a>
    </nav>
    <article class="player-page-panel" data-tier="${rankTier(player.rank)}">
      <div class="card-modal-body">${renderPlayerProfile(player, act)}</div>
    </article>
  `;
  bindProfileTabs(root);
}

/* ------------------ Dashboard (index.html) ------------------ */

function initDashboard() {
  currentAct = actsConfig.current;
  buildActNav();

  compareBtn.addEventListener("click", onCompareClick);

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

  // Cards are focusable; Enter or Space opens the same popup as a click.
  profiles.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    const card = event.target.closest(".card");
    if (!card || event.target !== card) return;

    event.preventDefault();
    card.click();
  });

  document.addEventListener("visibilitychange", refreshWhenStale);

  return loadStats();
}

async function init() {
  await loadActsConfig();
  if (isPlayerPage) {
    await initPlayerPage();
  } else {
    await initDashboard();
  }
}

init();
