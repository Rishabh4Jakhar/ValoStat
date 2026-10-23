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
  "rank_delta_sum", "rank_delta_matches",
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
    rank_delta_average: ratio(t.rank_delta_sum, t.rank_delta_matches, 2),
    rank_delta_matches: t.rank_delta_matches,

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

// Match grades come from the match's performance score.
const MATCH_GRADES = [
  { key: "distinction", label: "Distinction", range: "420–500" },
  { key: "merit", label: "Merit", range: "330–420" },
  { key: "pass", label: "Pass", range: "0–330" },
];

function modalGradeCards(grades) {
  const total = MATCH_GRADES.reduce((sum, grade) => sum + num(grades?.[grade.key]), 0);
  if (!total) {
    return `<p class="modal-empty">No match grades recorded for this period.</p>`;
  }

  const cards = MATCH_GRADES.map((grade) => {
    const count = num(grades?.[grade.key]);
    return `
      <article class="modal-mini-card grade-card" data-grade="${grade.key}">
        <span>${escapeHtml(grade.label)} <em>(${grade.range})</em></span>
        <strong>${modalNumber(count, 0)}</strong>
        <small>${modalNumber((count / total) * 100, 0)}% of graded matches</small>
      </article>
    `;
  });

  return `<div class="modal-mini-grid">${cards.join("")}</div>`;
}

// In-game impact ratings, from worst to best.
const RATING_LEVELS = ["double_down", "down", "neutral", "up", "double_up"];
const RATING_NAMES = {
  double_down: "Strongly down",
  down: "Down",
  neutral: "Neutral",
  up: "Up",
  double_up: "Strongly up",
};

// Typical rating across matches: the average of the per-match ratings
// (double down = -2 ... double up = +2), rounded to the nearest level.
function typicalRating(counts) {
  let total = 0;
  let sum = 0;
  RATING_LEVELS.forEach((level, index) => {
    const count = num(counts?.[level]);
    total += count;
    sum += count * (index - 2);
  });
  if (!total) return null;
  return { level: RATING_LEVELS[Math.round(sum / total) + 2], total };
}

function ratingIcon(level) {
  const shapes = {
    double_up: '<polyline points="3,9 8,4 13,9"/><polyline points="3,14 8,9 13,14"/>',
    up: '<polyline points="3,11 8,6 13,11"/>',
    neutral: '<line x1="4" y1="8" x2="12" y2="8"/>',
    down: '<polyline points="3,5 8,10 13,5"/>',
    double_down: '<polyline points="3,2 8,7 13,2"/><polyline points="3,7 8,12 13,7"/>',
  };
  return `<svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">${shapes[level] || shapes.neutral}</svg>`;
}

function ratingBreakdownText(counts) {
  return RATING_LEVELS.slice().reverse()
    .filter((level) => num(counts?.[level]) > 0)
    .map((level) => `${RATING_NAMES[level].toLowerCase()} ${num(counts[level])}`)
    .join(", ");
}

// Rows match the in-game performance screen. Each breakdown value sits next
// to the rating the API gives it (kill_impact rates adjusted kills, and so on).
const BREAKDOWN_ROWS = [
  [
    { key: "damage", label: "Damage", rating: ["combat", "damage"], digits: 1 },
    { key: "adjusted_kills", label: "Adjusted kills", rating: ["combat", "kill_impact"] },
    { key: "adjusted_deaths", label: "Adjusted deaths", rating: ["combat", "death_impact"] },
    { key: "trades", label: "Trades", rating: ["combat", "trades"] },
  ],
  [
    { key: "assists", label: "Assists", rating: ["utility", "assists"] },
    { key: "utility_usage", label: "Utility usage", rating: ["utility", "utility_usage"] },
    { key: "plants", label: "Plants", rating: ["utility", "plants"] },
    { key: "defuses", label: "Defuses", rating: ["utility", "defuses"] },
  ],
];

function renderBreakdownTable(player) {
  const averages = player.performance_breakdown_averages || {};
  const hasValues = Object.values(averages).some((value) => value != null);
  if (!hasValues) {
    return `<p class="modal-empty">No performance breakdown is available for this period.</p>`;
  }

  const column = (rows) => `
    <table class="breakdown-table">
      <thead>
        <tr><th scope="col">Stat</th><th scope="col">Per round</th><th scope="col">Impact</th></tr>
      </thead>
      <tbody>
        ${rows.map((row) => {
          const counts = player.performance_ratings?.[row.rating[0]]?.[row.rating[1]];
          const rating = typicalRating(counts);
          const detail = rating
            ? `Usually ${RATING_NAMES[rating.level].toLowerCase()} across ${rating.total} rated matches (${ratingBreakdownText(counts)})`
            : "No rating recorded";
          return `
            <tr>
              <th scope="row">${escapeHtml(row.label)}</th>
              <td>${modalNumber(averages[row.key], row.digits ?? 2)}</td>
              <td>
                ${rating
                  ? `<span class="impact impact-${rating.level}" role="img" aria-label="${escapeHtml(detail)}" title="${escapeHtml(detail)}">${ratingIcon(rating.level)}</span>`
                  : `<span class="impact impact-none" title="${detail}">–</span>`}
              </td>
            </tr>
          `;
        }).join("")}
      </tbody>
    </table>
  `;

  return `
    <div class="breakdown-grid">${BREAKDOWN_ROWS.map(column).join("")}</div>
    <p class="modal-footnote">Impact is the typical rating the game gave each stat across rated matches. Hover an icon to see how often each rating came up.</p>
  `;
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

const AGENT_ROLE_ORDER = ["Duelist", "Sentinel", "Initiator", "Controller"];

// Built-in roles, used until (or if) the live agent list below loads.
const AGENT_ROLES = {
  Jett: "Duelist", Phoenix: "Duelist", Reyna: "Duelist", Raze: "Duelist", Yoru: "Duelist",
  Neon: "Duelist", Iso: "Duelist", Waylay: "Duelist",
  Killjoy: "Sentinel", Cypher: "Sentinel", Sage: "Sentinel", Chamber: "Sentinel",
  Deadlock: "Sentinel", Vyse: "Sentinel", Veto: "Sentinel",
  Sova: "Initiator", Breach: "Initiator", Skye: "Initiator", "KAY/O": "Initiator",
  Fade: "Initiator", Gekko: "Initiator", Tejo: "Initiator",
  Brimstone: "Controller", Viper: "Controller", Omen: "Controller", Astra: "Controller",
  Harbor: "Controller", Clove: "Controller", Miks: "Controller", Hush: "Duelist",
};

// Live agent list (roles and official icons) from valorant-api.com, so new
// agents are classified without a code change.
let agentCatalog = {};

async function loadAgentCatalog() {
  try {
    const response = await fetch("https://valorant-api.com/v1/agents?isPlayableCharacter=true");
    if (!response.ok) return;
    const { data } = await response.json();
    (data || []).forEach((agent) => {
      if (!agent?.displayName) return;
      agentCatalog[agent.displayName] = {
        role: agent.role?.displayName || null,
        icon: agent.displayIcon || agent.displayIconSmall || null,
      };
    });
  } catch (error) {
    console.warn("Agent list unavailable; using built-in roles", error);
  }
}

function agentRole(name) {
  return agentCatalog[name]?.role || AGENT_ROLES[name] || null;
}

function agentImageUrl(name) {
  if (agentCatalog[name]?.icon) return agentCatalog[name].icon;
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
      ${stat("Trade kills", modalNumber(s.trade_kills, 0))}
      ${stat("Deaths traded", modalNumber(s.traded_deaths, 0))}
    </div>
  `;

  // Ability casts come from the match API's per-slot counts; utility usage is
  // the API's own per-round utility rating from the performance breakdown.
  const casts = s.ability_casts_per_round || {};
  const utilityUsage = s.performance_breakdown_averages?.utility_usage;
  const utility = s.legacy ? "" : `
    <div class="agent-block">
      <p class="agent-block-title">Utility <span>casts per round</span></p>
      <div class="agent-stats">
        ${stat("Grenade", modalNumber(casts.grenade, 2))}
        ${stat("Ability 1", modalNumber(casts.ability_1, 2))}
        ${stat("Ability 2", modalNumber(casts.ability_2, 2))}
        ${stat("Ultimate", modalNumber(casts.ultimate, 2))}
        ${stat("Ults / match", modalNumber(s.ultimates_per_match, 1))}
        ${stat("Utility usage", modalNumber(utilityUsage, 2))}
      </div>
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
          ${agentRole(name) ? `<span class="agent-role">${escapeHtml(agentRole(name))}</span>` : ""}
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
      ${utility}

      <div class="agent-time">${s.legacy ? `<span>${footer}</span>` : footer}</div>
    </article>
  `;
}

const AGENT_SORTS = [
  { key: "matches", label: "Most played", get: (s) => finite(s.matches) },
  { key: "winrate", label: "Win rate", get: (s) => finite(s.winrate) },
  { key: "acs", label: "ACS", get: (s) => finite(s.acs) },
  { key: "adr", label: "ADR", get: (s) => finite(s.adr) },
  { key: "kd", label: "K/D", get: (s) => finite(s.kd) },
  { key: "kast", label: "KAST", get: (s) => finite(s.kast) },
  { key: "hs", label: "Headshot %", get: (s) => finite(s.hs_percent) },
  { key: "performance", label: "Performance", get: (s) => finite(s.avg_performance_score) },
  { key: "firstBloods", label: "First bloods / match", get: (s) => (s.matches && s.first_bloods != null ? s.first_bloods / s.matches : null) },
  { key: "dd", label: "Damage delta", get: (s) => finite(s.dd_delta) },
  { key: "time", label: "Time played", get: (s) => finite(s.time_played_ms) },
];

// Filter by role, then sort. Agents with an unknown role only show while
// every role is selected, since they can't be placed in one.
function selectAgents(agents, roles, sortKey) {
  const sort = AGENT_SORTS.find((item) => item.key === sortKey) || AGENT_SORTS[0];
  const allRoles = roles.size === AGENT_ROLE_ORDER.length;
  return agents
    .filter(([name]) => {
      const role = agentRole(name);
      return role && AGENT_ROLE_ORDER.includes(role) ? roles.has(role) : allRoles;
    })
    .map((entry) => ({ entry, value: sort.get(agentSummary(entry[1])) }))
    .sort((a, b) => {
      if (a.value == null || b.value == null) return (a.value == null) - (b.value == null);
      return b.value - a.value;
    })
    .map((item) => item.entry);
}

function renderAgentSection(player) {
  const agents = Object.entries(player.agents || {})
    .sort((a, b) => (b[1].matches || 0) - (a[1].matches || 0));
  if (!agents.length) {
    return `<p class="modal-empty">Agent-specific stats are not available for this period.</p>`;
  }

  const counts = {};
  agents.forEach(([name]) => {
    const role = agentRole(name);
    counts[role] = (counts[role] || 0) + 1;
  });
  const detailed = agents.some(([, agent]) => agent.summary);

  return `
    <div class="agent-controls">
      <div class="role-filters" role="group" aria-label="Filter agents by role">
        <button type="button" class="role-toggle role-all" data-role="all" aria-pressed="true">
          All<span>${agents.length}</span>
        </button>
        ${AGENT_ROLE_ORDER.map((role) => `
          <button type="button" class="role-toggle" data-role="${role}" aria-pressed="false"${counts[role] ? "" : " data-empty"}>
            ${role}<span>${counts[role] || 0}</span>
          </button>
        `).join("")}
      </div>
      ${detailed ? `
        <label class="agent-sort">
          Sort by
          <select data-agent-sort>
            ${AGENT_SORTS.map((item) => `<option value="${item.key}">${escapeHtml(item.label)}</option>`).join("")}
          </select>
        </label>
      ` : ""}
    </div>
    <div class="agent-pool">${renderAgentPool(agents, player.summary?.matches ?? trackedMatches(player))}</div>
  `;
}

function bindAgentControls(root, player) {
  const section = root.querySelector('[data-panel="agents"]');
  const pool = section?.querySelector(".agent-pool");
  if (!pool) return;

  const agents = Object.entries(player.agents || {})
    .sort((a, b) => (b[1].matches || 0) - (a[1].matches || 0));
  const total = player.summary?.matches ?? trackedMatches(player);
  const roles = new Set(AGENT_ROLE_ORDER);
  const sortSelect = section.querySelector("[data-agent-sort]");

  const update = () => {
    const shown = selectAgents(agents, roles, sortSelect?.value || "matches");
    pool.innerHTML = shown.length
      ? renderAgentPool(shown, total)
      : `<p class="modal-empty">No agents played in the selected roles. Pick another role or All.</p>`;
  };

  // All roles show at first. Picking a role narrows to just that role;
  // further picks add or remove roles. Clearing every role, selecting all
  // four, or pressing All goes back to showing everything.
  const showAll = () => AGENT_ROLE_ORDER.forEach((role) => roles.add(role));
  const isAll = () => roles.size === AGENT_ROLE_ORDER.length;

  const syncButtons = () => {
    section.querySelectorAll(".role-toggle").forEach((button) => {
      const role = button.dataset.role;
      const pressed = role === "all" ? isAll() : !isAll() && roles.has(role);
      button.setAttribute("aria-pressed", String(pressed));
    });
  };

  section.querySelectorAll(".role-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const role = button.dataset.role;
      if (role === "all") {
        showAll();
      } else if (isAll()) {
        roles.clear();
        roles.add(role);
      } else if (roles.has(role)) {
        roles.delete(role);
        if (!roles.size) showAll();
      } else {
        roles.add(role);
      }
      syncButtons();
      update();
    });
  });
  sortSelect?.addEventListener("change", update);
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

  const mostPlayed = agents.reduce((best, entry) => (num(agentSummary(entry[1]).matches) > num(agentSummary(best[1]).matches) ? entry : best), agents[0]);
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
          <button id="cardModalCompare" class="modal-link-btn modal-page-btn" type="button">Compare</button>
          <a id="cardModalPageLink" class="modal-link-btn modal-page-btn" target="_blank" rel="noopener noreferrer">Open in New Page</a>
          <a id="cardModalOpenLink" class="modal-link-btn" target="_blank" rel="noopener noreferrer">Tracker</a>
          <button id="cardModalClose" class="modal-close-btn" type="button" aria-label="Close popup">×</button>
        </div>
      </div>
      <div class="card-modal-body" id="cardModalBody"></div>
    </div>
  `;

  document.body.appendChild(modal);

  modal.querySelector("#cardModalClose").addEventListener("click", () => closeCardModal());

  modal.querySelector("#cardModalCompare").addEventListener("click", (event) => {
    compareFromModal(event.currentTarget.dataset.playerId);
  });

  modal.addEventListener("click", (event) => {
    if (event.target === modal) closeCardModal();
  });

  document.addEventListener("keydown", (event) => {
    if (!modal.classList.contains("open")) return;
    if (event.key === "Escape") {
      closeCardModal();
      return;
    }
    // Keep Tab inside the popup while it's open.
    if (event.key === "Tab") {
      const focusable = [...modal.querySelectorAll('a[href], button:not([disabled]), select, input, [tabindex]:not([tabindex="-1"])')]
        .filter((el) => el.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  return modal;
}

let focusBeforeModal = null;

// Closing returns focus to whatever opened the popup (usually the card) and
// lets the page scroll again.
function closeCardModal({ restoreFocus = true } = {}) {
  const modal = document.getElementById("cardModal");
  if (!modal?.classList.contains("open")) return;
  modal.classList.remove("open");
  document.body.classList.remove("modal-open");
  if (restoreFocus && focusBeforeModal?.isConnected) {
    focusBeforeModal.focus({ preventScroll: true });
  }
  focusBeforeModal = null;
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
  bindRrCharts(body, player);
  bindAgentControls(body, player);

  openLink.href = trackerProfileUrl(player.riot_id || player.id);
  pageLink.href = playerPageUrl(player, act);
  modal.querySelector("#cardModalCompare").dataset.playerId = player.id;
  if (!modal.classList.contains("open")) focusBeforeModal = document.activeElement;
  modal.classList.add("open");
  document.body.classList.add("modal-open");
  body.scrollTop = 0;
  modal.querySelector("#cardModalClose").focus({ preventScroll: true });
}

// Full profile (hero, tabs, panels) used by both the popup and player.html.
function renderPlayerProfile(player, act) {
  const currentActLabel = getActLabel(act);
  const isOverall = act === "overall";
  const score = getDisplayedValoStatScore(player, act);

  const wins = Number(player.wins) || 0;
  const matches = Number(player.matches) || 0;
  // MMR data gives games and wins only; draws come from the tracked matches.
  const draws = Math.min(num(player.summary?.draws), Math.max(0, matches - wins));
  const losses = Math.max(0, matches - wins - draws);
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
          <div><dt>Record</dt><dd>${wins}W ${losses}L${draws ? ` ${draws}D` : ""}</dd></div>
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
      <button class="modal-tab" type="button" role="tab" aria-selected="false" data-tab="party">Party</button>
      <button class="modal-tab" type="button" role="tab" aria-selected="false" data-tab="matchmaking">Matchmaking</button>
      <button class="modal-tab" type="button" role="tab" aria-selected="false" data-tab="accolades">Accolades</button>
    </nav>

    <div class="modal-tab-panel active" data-panel="overview" role="tabpanel">
      <div class="modal-stats-grid">
        ${modalStat("Win rate", `${modalNumber(winRate, 1)}%`, `${wins} wins, ${losses} losses${draws ? `, ${draws} ${draws === 1 ? "draw" : "draws"}` : ""}`)}
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

      ${modalSection("Performance breakdown", "Per-round values from the match API, averaged across matches", renderBreakdownTable(player))}

      ${modalSection("Match grades", "Each match is graded by its performance score", modalGradeCards(player.performance_grades))}

      ${modalSection("Utility & economy", coverage || "Ability usage and spending", utilitySection)}
    </div>

    <div class="modal-tab-panel" data-panel="agents" role="tabpanel" hidden>
      ${modalSection("Agent pool", coverage || `${agents.length} agents with recorded stats`, renderAgentSection(player))}
    </div>

    <div class="modal-tab-panel" data-panel="party" role="tabpanel" hidden>
      ${renderPartyTab(player)}
    </div>

    <div class="modal-tab-panel" data-panel="matchmaking" role="tabpanel" hidden>
      <div class="modal-stats-grid">
        ${modalStat("Current rank", player.rank || "Unrated", `${modalNumber(player.rr, 0)} RR`)}
        ${modalStat("Average enemy rank", modalRank(rankEnemy == null ? null : Math.round(rankEnemy)), rankEnemy == null ? "Not enough rank data" : `Rank value ${modalNumber(rankEnemy, 2)} / 25, ${modalNumber(player.enemy_rank_matches, 0)} matches`)}
        ${modalStat("Average lobby rank", modalRank(rankLobby == null ? null : Math.round(rankLobby)), rankLobby == null ? "Not enough rank data" : `Rank value ${modalNumber(rankLobby, 2)} / 25`)}
        ${(() => {
          const delta = rankDeltaOf(player);
          const counted = num(player.summary?.rank_delta_matches ?? player.rank_delta_matches);
          return modalStat(
            "Enemy rank vs own",
            delta == null ? "N/A" : formatters.divisions(delta),
            delta == null ? "Recorded for new matches from now on" : `${describeRankDelta(delta)}, ${counted} ${counted === 1 ? "match" : "matches"}`
          );
        })()}
      </div>
      ${modalSection("RR over time", isOverall ? "Every act, each drawn as its own line" : "Rating at each update where it changed. Hover the line for details.", renderRrHistory(player))}

      ${modalSection("Recent matches", isOverall ? "Latest act, newest first" : "Last 10 matches, newest first", renderRecentMatches(player))}

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
  renderHighlights();
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

// Pairs each player with their entry from the previous update.
function computeDiff(curr, previous) {
  const previousMap = {};

  previous.forEach((player) => {
    if (player?.puuid) previousMap[`puuid:${player.puuid}`] = player;
    if (player?.riot_id) previousMap[`riot_id:${player.riot_id}`] = player;
    if (player?.id) previousMap[`id:${player.id}`] = player;
  });

  return curr.map((player) => {
    const old =
      previousMap[`puuid:${player.puuid}`] ||
      previousMap[`riot_id:${player.riot_id}`] ||
      previousMap[`id:${player.id}`];

    if (!old) return null;

    const changed =
      player.matches !== old.matches ||
      player.rank !== old.rank ||
      player.rr !== old.rr ||
      player.wins !== old.wins ||
      player.time_total !== old.time_total ||
      valoStatScore(player) !== valoStatScore(old);

    return { key: getPlayerMatchKey(player), diff: changed, old };
  }).filter(Boolean);
}

function agoText(time) {
  const minutes = Math.max(0, Math.floor((Date.now() - time) / 60000));
  if (minutes < 1) return "just now";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours >= 48) return `${Math.floor(hours / 24)}d ago`;
  return `${hours ? `${hours}h ` : ""}${rest || !hours ? `${rest}m ` : ""}ago`;
}

// meta.json (written by the fetcher) holds the real fetch time. The file's
// Last-Modified header is only a fallback: it changes on every site deploy,
// including code pushes, so it can make old data look fresh.
async function lastUpdate(response) {
  const updateTime = document.getElementById("updateTime");
  if (!updateTime) return;

  let checked = null;
  let changed = null;
  try {
    const meta = await fetch(`meta.json?ts=${Date.now()}`).then((r) => (r.ok ? r.json() : null));
    checked = Date.parse(meta?.checked_at || "");
    changed = Date.parse(meta?.changed_at || "");
  } catch (error) {
    // Fall through to the header.
  }

  if (!Number.isFinite(checked)) {
    const lastModified = Date.parse(response.headers.get("Last-Modified") || "");
    if (!Number.isFinite(lastModified)) return;
    updateTime.textContent = `Stats last updated ${agoText(lastModified)}`;
    return;
  }

  const stale = Number.isFinite(changed) && checked - changed > 10 * 60 * 1000;
  updateTime.textContent = stale
    ? `Checked ${agoText(checked)}, last change ${agoText(changed)}`
    : `Stats updated ${agoText(checked)}`;
  updateTime.title = `Checked ${new Date(checked).toLocaleString()}${Number.isFinite(changed) ? `\nLast changed ${new Date(changed).toLocaleString()}` : ""}`;
}

/* ---------- Highlights (current act, last 24 hours) ---------- */

const HIGHLIGHT_PERIODS = {
  "1d": { ms: 24 * 3600 * 1000, minMatches: 2, label: "24 hours" },
};
const highlightPeriod = "1d";

// Every match a player played in the window, oldest first.
function matchesInWindow(player, start) {
  const log = Array.isArray(player.match_log) && player.match_log.length
    ? player.match_log
    : (player.recent_matches || []).map((m) => ({ ...m, t: m.started_at }));
  return log
    .map((m) => ({ ...m, time: Date.parse(m.t || "") }))
    .filter((m) => Number.isFinite(m.time) && m.time >= start)
    .sort((a, b) => a.time - b.time);
}

function rrChangeInWindow(player, start) {
  const points = rrPoints(player);
  const inside = points.filter((p) => p.time >= start);
  if (!inside.length) return null;
  const before = points.filter((p) => p.time < start).pop() || inside[0];
  const last = inside[inside.length - 1];
  return { change: last.elo - before.elo, from: before, to: last };
}

function longestWinStreak(matches) {
  let best = 0;
  let run = 0;
  let bestEnd = null;
  matches.forEach((m) => {
    run = m.result === "win" ? run + 1 : 0;
    if (run > best) {
      best = run;
      bestEnd = m;
    }
  });
  return { length: best, end: bestEnd };
}

function windowRecord(matches) {
  const count = (result) => matches.filter((m) => m.result === result).length;
  return { wins: count("win"), losses: count("loss"), draws: count("draw") };
}

function buildHighlights(list, periodKey) {
  const period = HIGHLIGHT_PERIODS[periodKey];
  const start = Date.now() - period.ms;

  const rows = list.map((player) => {
    const matches = matchesInWindow(player, start);
    const record = windowRecord(matches);
    const scored = matches.filter((m) => finite(m.acs) != null);
    return {
      player,
      matches,
      record,
      rr: rrChangeInWindow(player, start),
      acs: scored.length ? scored.reduce((sum, m) => sum + m.acs, 0) / scored.length : null,
      winrate: matches.length ? (record.wins / matches.length) * 100 : null,
      best: matches.reduce((top, m) => (finite(m.performance_score) != null && (!top || m.performance_score > top.performance_score) ? m : top), null),
      streak: longestWinStreak(matches),
    };
  });

  const top = (filter, value, detail) => rows
    .filter(filter)
    .sort((a, b) => value(b) - value(a))
    .slice(0, 3)
    .map((row) => ({ row, value: value(row), detail: detail(row) }));

  const enough = (row) => row.matches.length >= period.minMatches;
  const recordText = (r) => formatRecord(r.wins, r.losses, r.draws);

  return [
    {
      title: "Biggest climb",
      empty: "No one gained RR",
      format: (v) => `+${v} RR`,
      entries: top((r) => r.rr && r.rr.change > 0, (r) => r.rr.change,
        (r) => (r.rr.from.rank === r.rr.to.rank ? `${r.rr.to.rank}, ${num(r.rr.to.rr)} RR` : `${r.rr.from.rank} to ${r.rr.to.rank}`)),
    },
    {
      title: "Most matches",
      empty: "No matches played",
      format: (v) => `${v} ${v === 1 ? "match" : "matches"}`,
      entries: top((r) => r.matches.length > 0, (r) => r.matches.length, (r) => recordText(r.record)),
    },
    {
      title: "Best match",
      empty: "No rated matches",
      format: (v) => `${Math.round(v)}`,
      unit: "performance",
      entries: top((r) => r.best, (r) => r.best.performance_score,
        (r) => `${r.best.agent} on ${r.best.map}, ${num(r.best.rounds_won)}–${num(r.best.rounds_lost)}, ${num(r.best.kills)}/${num(r.best.deaths)}/${num(r.best.assists)}`),
    },
    {
      title: "Highest ACS",
      empty: "No matches played",
      format: (v) => `${Math.round(v)}`,
      unit: "ACS",
      entries: top((r) => r.acs != null, (r) => r.acs,
        (r) => `${r.matches.length} ${r.matches.length === 1 ? "match" : "matches"}`),
    },
    {
      title: "Best win rate",
      empty: `Needs ${period.minMatches}+ matches`,
      note: `Min ${period.minMatches} matches`,
      format: (v) => `${Math.round(v)}%`,
      entries: top((r) => enough(r), (r) => r.winrate + r.matches.length / 1000, (r) => recordText(r.record)),
    },
    {
      title: "Longest win streak",
      empty: "No streaks of 2+ wins",
      format: (v) => `${Math.floor(v)} wins`,
      entries: top((r) => r.streak.length >= 2, (r) => r.streak.length,
        (r) => `Ended ${timeAgo(r.streak.end.t)}`),
    },
  ];
}

function renderHighlights() {
  const section = document.querySelector(".highlights");
  const grid = document.getElementById("highlightGrid");
  const note = document.getElementById("highlightsNote");
  if (!section || !grid) return;

  // Only the current act has match logs and RR history.
  const list = Array.isArray(cache) ? cache.filter((p) => p.rr_history || p.match_log || p.recent_matches) : [];
  if (!list.length) {
    section.hidden = true;
    return;
  }
  section.hidden = false;

  const period = HIGHLIGHT_PERIODS[highlightPeriod];
  const tiles = buildHighlights(list, highlightPeriod);
  const totalMatches = new Set(list.flatMap((p) => matchesInWindow(p, Date.now() - period.ms).map((m) => m.match_id))).size;
  note.textContent = `${getActLabel(actsConfig.current)}, last ${period.label}: ${totalMatches} ${totalMatches === 1 ? "match" : "matches"} across the group`;

  // A one-line preview on the collapsed bar, to make it worth opening.
  const teaser = document.getElementById("highlightsTeaser");
  if (teaser) {
    const climb = tiles[0].entries[0];
    const best = tiles[2].entries[0];
    const played = `${totalMatches} ${totalMatches === 1 ? "match" : "matches"} played`;
    teaser.textContent = !totalMatches
      ? "No matches in the last 24 hours"
      : climb
        ? `Last 24 hours: ${climb.row.player.id} climbed ${climb.value} RR, ${played}`
        : best
          ? `Last 24 hours: ${best.row.player.id} scored ${Math.round(best.value)} performance, ${played}`
          : `Last 24 hours: ${played}`;
  }

  grid.innerHTML = tiles.map((tile) => {
    const [leader, ...rest] = tile.entries;
    const name = (row) => `
      <button type="button" class="highlight-player" data-player-id="${escapeHtml(row.player.id)}" data-tier="${rankTier(row.player.rank)}">${escapeHtml(row.player.id)}</button>
    `;
    return `
      <article class="highlight-tile"${leader ? ` data-tier="${rankTier(leader.row.player.rank)}"` : ""}>
        <header>
          <h3>${escapeHtml(tile.title)}</h3>
          ${tile.note ? `<span>${escapeHtml(tile.note)}</span>` : ""}
        </header>
        ${leader ? `
          <div class="highlight-leader">
            ${name(leader.row)}
            <strong>${escapeHtml(tile.format(leader.value))}${tile.unit ? `<small>${escapeHtml(tile.unit)}</small>` : ""}</strong>
            <p>${escapeHtml(leader.detail)}</p>
          </div>
          ${rest.length ? `
            <ol class="highlight-rest" start="2">
              ${rest.map((entry) => `
                <li>
                  ${name(entry.row)}
                  <span>${escapeHtml(tile.format(entry.value))}</span>
                </li>
              `).join("")}
            </ol>
          ` : ""}
        ` : `<p class="highlight-empty">${escapeHtml(tile.empty)}</p>`}
      </article>
    `;
  }).join("");
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
  "rank_delta_sum", "rank_delta_matches",
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

    // Party stats exist from the current fetcher onwards; recent matches and
    // RR history come from the newest act the player appears in.
    party: entries.some((entry) => entry.player.party)
      ? entries.reduce((all, entry) => mergeParty(all, entry.player.party), { by_size: {}, friends: {} })
      : null,
    recent_matches: base.recent_matches || [],
    rr_history: entries
      .flatMap((entry) => (entry.player.rr_history || []).map((point) => ({ ...point, act: entry.label })))
      .sort((a, b) => Date.parse(a.t) - Date.parse(b.t)),
    schema_version: base.schema_version,

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
/* ------------------ Stat definitions ------------------ */
// One list drives the sort menu, the highlighted stat on cards and the
// player comparison. `better` says which direction wins: "high", "low", or
// null when neither is better (shown without a winner).

function finite(value) {
  const number = Number(value);
  return value != null && value !== "" && Number.isFinite(number) ? number : null;
}

// Average enemy rank minus the player's own rank, in rank divisions
// (+0.5 = enemies half a division higher). Only matches fetched after this
// was added are counted; earlier matches were never re-fetched.
function rankDeltaOf(p) {
  return finite(p?.summary?.rank_delta_average ?? p?.rank_delta_average);
}

function describeRankDelta(value) {
  if (value == null) return "";
  if (Math.abs(value) < 0.05) return "Enemies at your rank";
  const amount = fixedNumber(Math.abs(value), 2);
  return value > 0 ? `Enemies ${amount} divisions higher` : `Enemies ${amount} divisions lower`;
}

function rankValue(rank) {
  return rankValues[rank] || 0;
}

function hasMatches(p) {
  return Number(p?.matches) > 0;
}

function summaryRate(p, getCount) {
  const s = p?.summary;
  return s && s.matches ? getCount(s) / s.matches : null;
}

function totalCastsPerRound(p) {
  const casts = p?.summary?.ability_casts_per_round;
  if (!casts) return null;
  const values = Object.values(casts).map(finite).filter((value) => value != null);
  return values.length ? values.reduce((a, b) => a + b, 0) : null;
}

// Fixed decimals keep a column of values the same width (1.50, not 1.5).
function fixedNumber(value, digits) {
  return value == null
    ? "N/A"
    : value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

const formatters = {
  int: (v) => modalNumber(v, 0),
  dec1: (v) => fixedNumber(v, 1),
  dec2: (v) => fixedNumber(v, 2),
  pct: (v) => modalPercent(v),
  signed: (v) => (v == null ? "N/A" : `${v > 0 ? "+" : ""}${modalNumber(v, 1)}`),
  time: (v) => (v == null ? "N/A" : formatTime(v)),
  rankAverage: (v) => (v == null ? "N/A" : `${modalRank(Math.round(v))} (${modalNumber(v, 1)})`),
  divisions: (v) => (v == null ? "N/A" : `${v > 0 ? "+" : ""}${fixedNumber(v, 2)}`),
};

const STAT_GROUPS = ["General", "Combat", "Impact", "Utility & economy", "Matchmaking"];

const STATS = [
  { key: "score", label: "ValoStat score", group: "General", get: (p, act) => getDisplayedValoStatScore(p, act), format: (v) => formatScore(v) },
  { key: "rank", label: "Rank", group: "General", compare: false, get: (p) => finite(p.elo) ?? (rankValue(p.rank) * 100 + num(p.rr)), format: (v, p) => p.rank || "Unrated" },
  { key: "winPercentage", label: "Win rate", short: "Win %", group: "General", get: (p) => (hasMatches(p) ? finite(p.winrate) : null), format: formatters.pct },
  { key: "matchesPlayed", label: "Matches played", group: "General", get: (p) => finite(p.matches), format: formatters.int },
  { key: "wins", label: "Wins", group: "General", compare: false, get: (p) => (hasMatches(p) ? finite(p.wins) : null), format: (v, p) => (v == null ? "N/A" : `${num(p.wins)}/${num(p.matches)}`) },
  { key: "time", label: "Time played", short: "Playtime", group: "General", get: (p) => (hasMatches(p) ? finite(p.time_total) : null), format: formatters.time },
  { key: "level", label: "Account level", group: "General", compare: false, get: (p) => finite(p.level), format: formatters.int },

  { key: "performance", label: "Avg performance score", short: "Performance", group: "Combat", get: (p) => (num(p.performance_score_matches) > 0 ? finite(p.avg_performance_score) : null), format: formatters.dec1 },
  { key: "acs", label: "ACS", group: "Combat", get: (p) => (hasMatches(p) ? finite(p.avg_acs) : null), format: formatters.dec1 },
  { key: "adr", label: "ADR", group: "Combat", get: (p) => finite(p.summary?.adr), format: formatters.dec1 },
  { key: "kd", label: "K/D", group: "Combat", get: (p) => (hasMatches(p) ? finite(p.kd) : null), format: formatters.dec2 },
  { key: "kad", label: "KA/D", group: "Combat", get: (p) => (hasMatches(p) ? finite(p.kad) : null), format: formatters.dec2 },
  { key: "kast", label: "KAST", group: "Combat", get: (p) => (hasMatches(p) ? finite(p.kast) : null), format: formatters.pct },
  { key: "dd", label: "Damage delta / round", short: "Damage delta", group: "Combat", get: (p) => (hasMatches(p) ? finite(p.dd_delta) : null), format: formatters.signed },
  { key: "hs", label: "Headshot %", group: "Combat", get: (p) => (num(p.headshots_total) + num(p.bodyshots_total) + num(p.legshots_total) > 0 ? finite(p.hs_percent) : null), format: formatters.pct },
  { key: "kills", label: "Kills / match", group: "Combat", get: (p) => perMatch(p, p.kills_total), format: formatters.dec2 },
  { key: "deaths", label: "Deaths / match", group: "Combat", better: "low", get: (p) => perMatch(p, p.deaths_total), format: formatters.dec2 },
  { key: "assists", label: "Assists / match", group: "Combat", get: (p) => perMatch(p, p.assists_total), format: formatters.dec2 },

  { key: "openingDuels", label: "Opening duels won", group: "Impact", get: (p) => finite(p.summary?.opening_duel_winrate), format: formatters.pct },
  { key: "firstBloods", label: "First bloods / match", group: "Impact", get: (p) => summaryRate(p, (s) => num(s.first_bloods)), format: formatters.dec2 },
  { key: "tradeKills", label: "Trade kills / match", group: "Impact", get: (p) => summaryRate(p, (s) => num(s.trade_kills)), format: formatters.dec2 },
  { key: "multikills", label: "3K+ rounds / match", group: "Impact", get: (p) => summaryRate(p, (s) => num(s.multikills?.["3k"]) + num(s.multikills?.["4k"]) + num(s.multikills?.["5k"])), format: formatters.dec2 },
  { key: "clutches", label: "Clutches", group: "Impact", get: (p) => finite(p.summary?.clutches), format: formatters.int },
  { key: "aces", label: "Aces", group: "Impact", get: (p) => finite(p.summary?.multikills?.["5k"]), format: formatters.int },
  { key: "mvps", label: "Match MVPs", group: "Impact", get: (p) => finite(p.summary?.match_mvps), format: formatters.int },
  { key: "roundWin", label: "Round win rate", group: "Impact", get: (p) => finite(p.summary?.round_winrate), format: formatters.pct },

  { key: "utilityUsage", label: "Utility usage", group: "Utility & economy", get: (p) => (num(p.performance_score_matches) > 0 ? finite(p.performance_breakdown_averages?.utility_usage) : null), format: formatters.dec2 },
  { key: "abilityCasts", label: "Ability casts / round", group: "Utility & economy", get: totalCastsPerRound, format: formatters.dec2 },
  { key: "ults", label: "Ultimates / match", group: "Utility & economy", get: (p) => finite(p.summary?.ultimates_per_match), format: formatters.dec2 },
  { key: "spend", label: "Credits spent / round", group: "Utility & economy", better: null, get: (p) => finite(p.summary?.avg_spent_per_round), format: formatters.int },

  { key: "enemyRank", label: "Avg enemy rank", group: "Matchmaking", better: null, get: (p) => finite(p.enemy_rank_average_value), format: formatters.rankAverage },
  { key: "lobbyRank", label: "Avg lobby rank", group: "Matchmaking", better: null, get: (p) => finite(p.lobby_rank_average_value), format: formatters.rankAverage },
  { key: "rankDelta", label: "Enemy rank vs own", group: "Matchmaking", better: null, get: (p) => rankDeltaOf(p), format: formatters.divisions },
].map((stat) => ({ better: "high", compare: true, ...stat }));

const STAT_BY_KEY = Object.fromEntries(STATS.map((stat) => [stat.key, stat]));

// Stats shown on every player card (3 x 2 grid).
const CARD_STATS = ["performance", "wins", "winPercentage", "kd", "kast", "time"];

function statValue(stat, player, act = currentAct) {
  return finite(stat.get(player, act));
}

function statText(stat, player, act = currentAct) {
  return stat.format(statValue(stat, player, act), player);
}

/* ------------------ Sorting ------------------ */

let sortDirection = "desc";

function buildSortMenu() {
  const select = document.getElementById("sortSelect");
  select.innerHTML = `<option value="default">Default order</option>` + STAT_GROUPS.map((group) => `
    <optgroup label="${escapeHtml(group)}">
      ${STATS.filter((stat) => stat.group === group).map((stat) => `
        <option value="${stat.key}">${escapeHtml(stat.label)}</option>
      `).join("")}
    </optgroup>
  `).join("");
}

// Older acts don't have every stat; disable the ones nobody has.
function updateSortAvailability(data, act) {
  const select = document.getElementById("sortSelect");
  STATS.forEach((stat) => {
    const option = select.querySelector(`option[value="${stat.key}"]`);
    if (!option) return;
    const available = data.some((player) => statValue(stat, player, act) != null);
    option.disabled = !available;
    option.textContent = available ? stat.label : `${stat.label} (not tracked)`;
  });

  if (select.selectedOptions[0]?.disabled) {
    select.value = "default";
  }
  updateSortDirectionButton();
}

function updateSortDirectionButton() {
  const button = document.getElementById("sortDirection");
  if (!button) return;
  const isDefault = document.getElementById("sortSelect").value === "default";
  button.disabled = isDefault;
  button.textContent = sortDirection === "desc" ? "Highest first" : "Lowest first";
  button.setAttribute("aria-label", `Sort direction: ${button.textContent}. Click to reverse.`);
}

function sortPlayers(data, stat, act) {
  const direction = sortDirection === "desc" ? -1 : 1;
  return data.sort((a, b) => {
    const va = statValue(stat, a, act);
    const vb = statValue(stat, b, act);
    // Players without a value always go last, whichever the direction.
    if (va == null || vb == null) return (va == null) - (vb == null);
    return (va - vb) * direction;
  });
}

/* ------------------ Recent form, RR history and party ------------------ */

const RESULT_NAMES = { win: "Win", loss: "Loss", draw: "Draw" };
const PARTY_NAMES = { 1: "Solo", 2: "Duo", 3: "Trio", 4: "4-stack", 5: "5-stack" };

function partyName(size) {
  return PARTY_NAMES[size] || `${size}-stack`;
}

function timeAgo(iso) {
  const time = Date.parse(iso || "");
  if (!Number.isFinite(time)) return "";
  const minutes = Math.round((Date.now() - time) / 60000);
  if (minutes < 60) return `${Math.max(minutes, 1)}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days <= 14) return `${days}d ago`;
  return new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function shortDate(iso) {
  const time = Date.parse(iso || "");
  return Number.isFinite(time)
    ? new Date(time).toLocaleDateString(undefined, { day: "numeric", month: "short" })
    : "";
}

function matchSummaryText(match) {
  return `${RESULT_NAMES[match.result] || "Match"} ${num(match.rounds_won)}–${num(match.rounds_lost)} on ${match.map || "unknown map"} as ${match.agent || "unknown agent"}`;
}

// Last 10 results on a player card, oldest on the left.
function renderFormStrip(player) {
  const recent = Array.isArray(player.recent_matches) ? player.recent_matches : [];
  if (!recent.length) return "";

  const ordered = recent.slice().reverse();
  const wins = ordered.filter((m) => m.result === "win").length;
  const losses = ordered.filter((m) => m.result === "loss").length;
  const draws = ordered.filter((m) => m.result === "draw").length;
  const dots = ordered.map((m) => `
    <i class="form-dot form-${escapeHtml(m.result || "draw")}" title="${escapeHtml(matchSummaryText(m))}"></i>
  `).join("");

  return `
    <div class="card-form" role="img" aria-label="Last ${ordered.length} matches: ${wins} wins, ${losses} losses${draws ? `, ${draws} draws` : ""}">
      <span class="card-form-label">Last ${ordered.length}</span>
      <span class="form-dots">${dots}</span>
      <span class="card-form-record">${formatRecord(wins, losses, draws)}</span>
    </div>
  `;
}

// Older act files predate these features; the current act fills in on the next refresh.
function notYetTracked(player, what) {
  return player.schema_version || player.summary
    ? `<p class="modal-empty">${what} appear after the next data refresh.</p>`
    : `<p class="modal-empty">${what} aren't recorded for this act.</p>`;
}

function renderRecentMatches(player) {
  const recent = Array.isArray(player.recent_matches) ? player.recent_matches : [];
  if (!recent.length) return notYetTracked(player, "Recent matches");

  const rows = recent.map((m) => {
    const others = Math.max(0, num(m.party_size) - 1 - (m.party_with || []).length);
    const withText = (m.party_with || []).length
      ? `with ${m.party_with.join(", ")}${others ? ` +${others}` : ""}`
      : num(m.party_size) > 1 ? `with ${others} not tracked` : "";
    const kd = num(m.deaths) ? num(m.kills) / num(m.deaths) : num(m.kills);
    const mvp = m.match_mvp ? "Match MVP" : m.team_mvp ? "Team MVP" : "";

    return `
      <li class="match-row" data-result="${escapeHtml(m.result || "draw")}">
        <span class="match-result">${RESULT_NAMES[m.result] || "—"}${mvp ? `<small>${mvp}</small>` : ""}</span>
        <span class="match-score">${num(m.rounds_won)}–${num(m.rounds_lost)}<small>${escapeHtml(m.map || "")}</small></span>
        <span class="match-agent">${escapeHtml(m.agent || "")}<small>${escapeHtml(timeAgo(m.started_at))}</small></span>
        <span class="match-lobby"${m.rank_delta != null ? ` title="${escapeHtml(describeRankDelta(m.rank_delta))}"` : ""}>${m.lobby_rank_value == null ? "—" : escapeHtml(modalRank(Math.round(m.lobby_rank_value)))}<small class="${m.rank_delta > 0.05 ? "delta-up" : m.rank_delta < -0.05 ? "delta-down" : ""}">${m.rank_delta == null ? "Lobby rank" : `Enemies ${formatters.divisions(m.rank_delta)}`}</small></span>
        <span class="match-kda">${num(m.kills)} / ${num(m.deaths)} / ${num(m.assists)}<small>K/D ${fixedNumber(kd, 2)}</small></span>
        <span class="match-acs">${m.acs == null ? "—" : Math.round(m.acs)}<small>ACS</small></span>
        <span class="match-perf">${m.performance_score == null ? "—" : Math.round(m.performance_score)}<small>${escapeHtml(m.grade ? m.grade.charAt(0).toUpperCase() + m.grade.slice(1) : "Performance")}</small></span>
        <span class="match-party">${partyName(num(m.party_size) || 1)}<small>${escapeHtml(withText)}</small></span>
      </li>
    `;
  }).join("");

  return `<ol class="match-list">${rows}</ol>`;
}

/* ---------- RR over time ---------- */
// One point is stored each time a player's rating changes (checked every
// update). The chart uses a real time axis, a range picker like a stock
// chart, and colours the line by the rank tier it passes through.

const RR_RANGES = [
  { key: "1d", label: "1D", ms: 24 * 3600 * 1000 },
  { key: "1w", label: "1W", ms: 7 * 24 * 3600 * 1000 },
  { key: "1m", label: "1M", ms: 30 * 24 * 3600 * 1000 },
  { key: "all", label: "All", ms: null },
];

// Rating ("elo" in the API) is 100 per rank division: Iron 1 starts at 0,
// so each tier (3 divisions) spans 300. Immortal and above share the top band.
const TIER_BANDS = [
  ["iron", 0, 300], ["bronze", 300, 600], ["silver", 600, 900], ["gold", 900, 1200],
  ["platinum", 1200, 1500], ["diamond", 1500, 1800], ["ascendant", 1800, 2100],
  ["immortal", 2100, Infinity],
];

let rrChartCount = 0;

function rrPoints(player) {
  return (Array.isArray(player.rr_history) ? player.rr_history : [])
    .map((point) => ({ ...point, time: Date.parse(point.t), elo: finite(point.elo) }))
    .filter((point) => Number.isFinite(point.time) && point.elo != null)
    .sort((a, b) => a.time - b.time);
}

function defaultRrRange(points) {
  if (points.length < 2) return "all";
  const span = points[points.length - 1].time - points[0].time;
  return span > 30 * 24 * 3600 * 1000 ? "1m" : "all";
}

function rrTimeLabel(time, span) {
  const date = new Date(time);
  if (span <= 2 * 24 * 3600 * 1000) {
    return date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  if (span <= 14 * 24 * 3600 * 1000) {
    return `${date.toLocaleDateString(undefined, { weekday: "short" })} ${date.getDate()}`;
  }
  return date.toLocaleDateString(undefined, { day: "numeric", month: "short" });
}

function rrFullTime(time) {
  return new Date(time).toLocaleString(undefined, {
    weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit",
  });
}

// Points inside the range, plus the value carried in from before it and the
// current value extended to "now", so the line always spans the whole range.
function rrWindow(points, rangeKey) {
  const range = RR_RANGES.find((item) => item.key === rangeKey) || RR_RANGES[3];
  const last = points[points.length - 1];
  const end = Math.max(Date.now(), last.time);
  const start = range.ms ? end - range.ms : points[0].time;

  const inside = points.filter((point) => point.time >= start);
  const before = points.filter((point) => point.time < start).pop();
  const series = [];
  if (before) series.push({ ...before, time: start, carried: true });
  series.push(...inside);
  series.push({ ...last, time: end, extended: true });

  return { start, end: Math.max(end, start + 1), inside, startValue: (before || inside[0] || last).elo, series };
}

function renderRrChart(points, rangeKey, chartId) {
  const { start, end, inside, series } = rrWindow(points, rangeKey);
  const last = points[points.length - 1];

  // Ranks reset between acts, so in Overall the change is measured within
  // the latest act only.
  const sameAct = last.act ? points.filter((point) => point.act === last.act) : points;
  const actWindow = rrWindow(sameAct, rangeKey);
  const startValue = Math.max(actWindow.start, sameAct[0].time) === sameAct[0].time && actWindow.start <= sameAct[0].time
    ? sameAct[0].elo
    : actWindow.startValue;
  const net = last.elo - startValue;
  const actNote = last.act && sameAct.length < points.length ? ` (${last.act})` : "";
  const peak = series.reduce((best, point) => (point.elo > best.elo ? point : best), series[0]);
  const rangeLabel = RR_RANGES.find((item) => item.key === rangeKey)?.label || "All";

  const width = 760;
  const height = 240;
  const pad = { top: 14, right: 16, bottom: 28, left: 96 };
  const elos = series.map((point) => point.elo);
  let low = Math.floor((Math.min(...elos) - 15) / 100) * 100;
  let high = Math.ceil((Math.max(...elos) + 15) / 100) * 100;
  if (high - low < 100) high = low + 100;

  const x = (time) => pad.left + ((time - start) / (end - start)) * (width - pad.left - pad.right);
  const y = (elo) => pad.top + (1 - (elo - low) / (high - low)) * (height - pad.top - pad.bottom);

  // Rank gridlines: every division when there are few, otherwise each tier.
  const divisions = (high - low) / 100;
  const step = divisions <= 8 ? 100 : 300;
  const grid = [];
  for (let elo = Math.ceil(low / step) * step; elo <= high; elo += step) {
    const tierEdge = elo % 300 === 0;
    grid.push(`<line class="rr-grid${tierEdge ? " rr-grid-tier" : ""}" x1="${pad.left}" x2="${width - pad.right}" y1="${y(elo)}" y2="${y(elo)}" />`);
    if (elo + step <= high) {
      const label = step === 100
        ? modalRank(Math.floor(elo / 100) + 1)
        : modalRank(Math.floor(elo / 100) + 1).replace(/ \d$/, "");
      grid.push(`<text class="rr-rank" x="${pad.left - 10}" y="${(y(elo) + y(elo + step)) / 2 + 4}" text-anchor="end">${escapeHtml(label)}</text>`);
    }
  }

  // Line colour follows the tier at each height (hard stops at tier edges).
  const gradientId = `rrTier${chartId}`;
  const stops = [];
  TIER_BANDS.slice().reverse().forEach(([tier, from, to]) => {
    const top = Math.min(to, high);
    const bottom = Math.max(from, low);
    if (top <= bottom) return;
    const offset = (elo) => ((high - elo) / (high - low)).toFixed(4);
    stops.push(`<stop offset="${offset(top)}" style="stop-color: var(--tier-${tier})" />`);
    stops.push(`<stop offset="${offset(bottom)}" style="stop-color: var(--tier-${tier})" />`);
  });

  // In Overall, acts are drawn as separate lines (ranks reset between acts).
  const segments = [];
  series.forEach((point) => {
    const current = segments[segments.length - 1];
    if (!current || (point.act && current.act !== point.act)) {
      segments.push({ act: point.act, points: [point] });
    } else {
      current.points.push(point);
    }
  });
  const baseline = height - pad.bottom;
  const lines = segments.map((segment) => {
    const coords = segment.points.map((point) => `${x(point.time).toFixed(1)},${y(point.elo).toFixed(1)}`);
    const first = segment.points[0];
    const lastPoint = segment.points[segment.points.length - 1];
    return `
      <polygon class="rr-area" fill="url(#${gradientId})" points="${x(first.time).toFixed(1)},${baseline} ${coords.join(" ")} ${x(lastPoint.time).toFixed(1)},${baseline}" />
      <polyline class="rr-line" stroke="url(#${gradientId})" points="${coords.join(" ")}" />
    `;
  }).join("");
  const actMarks = segments.slice(1).map((segment) => {
    const at = x(segment.points[0].time);
    return `
      <line class="rr-act" x1="${at}" x2="${at}" y1="${pad.top}" y2="${baseline}" />
      <text class="rr-axis" x="${at + 4}" y="${pad.top + 12}">${escapeHtml(segment.act)}</text>
    `;
  }).join("");

  const dots = inside.length <= 40
    ? inside.map((point) => `<circle class="rr-dot" cx="${x(point.time).toFixed(1)}" cy="${y(point.elo).toFixed(1)}" r="3" stroke="url(#${gradientId})" />`).join("")
    : "";

  const ticks = Array.from({ length: 5 }, (_, i) => start + ((end - start) * i) / 4).map((time, i) => `
    <text class="rr-axis" x="${x(time)}" y="${height - 8}" text-anchor="${i === 0 ? "start" : i === 4 ? "end" : "middle"}">${escapeHtml(rrTimeLabel(time, end - start))}</text>
  `).join("");

  const noChange = inside.length === 0;
  const signed = (value) => `${value > 0 ? "+" : ""}${value} RR`;

  return `
    <div class="modal-stats-grid rr-summary">
      ${modalStat(`Change, ${rangeLabel}${actNote}`, signed(net), noChange ? "No rating change in this range" : `From ${modalRank(Math.floor(startValue / 100) + 1)}, ${((startValue % 100) + 100) % 100} RR`)}
      ${modalStat(`Peak, ${rangeLabel}`, peak.rank, `${num(peak.rr)} RR`)}
      ${modalStat("Now", last.rank, `${num(last.rr)} RR`)}
      ${modalStat(`Rating changes, ${rangeLabel}`, modalNumber(inside.length, 0), "Checked every 4 hours")}
    </div>
    <div class="rr-chart-wrap">
      <svg class="rr-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="RR over the selected range: ${signed(net)}, now ${escapeHtml(last.rank)} ${num(last.rr)} RR">
        <defs>
          <linearGradient id="${gradientId}" gradientUnits="userSpaceOnUse" x1="0" x2="0" y1="${y(high)}" y2="${y(low)}">
            ${stops.join("")}
          </linearGradient>
        </defs>
        ${grid.join("")}
        ${actMarks}
        ${lines}
        ${dots}
        ${ticks}
        <line class="rr-cursor" x1="0" x2="0" y1="${pad.top}" y2="${baseline}" hidden />
        <circle class="rr-cursor-dot" r="5" cx="0" cy="0" stroke="url(#${gradientId})" hidden />
        <rect class="rr-hit" x="${pad.left}" y="${pad.top}" width="${width - pad.left - pad.right}" height="${baseline - pad.top}" />
      </svg>
      <div class="rr-tooltip" hidden></div>
    </div>
  `;
}

function renderRrHistory(player) {
  const points = rrPoints(player);
  if (!points.length) return notYetTracked(player, "RR changes");

  if (points.length < 2) {
    return `<p class="modal-empty">Tracking started ${escapeHtml(shortDate(points[0].t))} at ${escapeHtml(points[0].rank)}, ${num(points[0].rr)} RR. The graph appears once the rating changes.</p>`;
  }

  const range = defaultRrRange(points);
  const chartId = ++rrChartCount;
  return `
    <div class="rr-block" data-rr-chart="${chartId}">
      <div class="rr-ranges" role="group" aria-label="Time range">
        ${RR_RANGES.map((item) => `
          <button type="button" class="rr-range" data-range="${item.key}" aria-pressed="${item.key === range}">${item.label}</button>
        `).join("")}
      </div>
      <div class="rr-body">${renderRrChart(points, range, chartId)}</div>
    </div>
  `;
}

// Range buttons and the hover readout.
function bindRrCharts(root, player) {
  const points = rrPoints(player);
  root.querySelectorAll("[data-rr-chart]").forEach((block) => {
    const chartId = block.dataset.rrChart;
    let range = block.querySelector('.rr-range[aria-pressed="true"]')?.dataset.range || "all";

    const attachHover = () => {
      const svg = block.querySelector(".rr-chart");
      const tooltip = block.querySelector(".rr-tooltip");
      const cursor = block.querySelector(".rr-cursor");
      const cursorDot = block.querySelector(".rr-cursor-dot");
      const hit = block.querySelector(".rr-hit");
      if (!svg || !hit) return;

      const { start, end, inside, series } = rrWindow(points, range);
      const real = inside.length ? inside : [series[series.length - 1]];
      const box = svg.viewBox.baseVal;
      const plotLeft = Number(hit.getAttribute("x"));
      const plotWidth = Number(hit.getAttribute("width"));
      const plotTop = Number(hit.getAttribute("y"));
      const plotHeight = Number(hit.getAttribute("height"));
      const elos = series.map((p) => p.elo);
      let low = Math.floor((Math.min(...elos) - 15) / 100) * 100;
      let high = Math.ceil((Math.max(...elos) + 15) / 100) * 100;
      if (high - low < 100) high = low + 100;
      const toX = (time) => plotLeft + ((time - start) / (end - start)) * plotWidth;
      const toY = (elo) => plotTop + (1 - (elo - low) / (high - low)) * plotHeight;

      const show = (event) => {
        const rect = svg.getBoundingClientRect();
        const svgX = ((event.clientX - rect.left) / rect.width) * box.width;
        const time = start + ((svgX - plotLeft) / plotWidth) * (end - start);
        const nearest = real.reduce((best, p) => (Math.abs(p.time - time) < Math.abs(best.time - time) ? p : best), real[0]);
        const index = points.findIndex((p) => p.time === nearest.time && p.elo === nearest.elo);
        const previous = index > 0 ? points[index - 1] : null;
        const sameAct = previous && (!previous.act || previous.act === nearest.act);
        const delta = sameAct ? nearest.elo - previous.elo : null;
        const games = sameAct && nearest.matches != null && previous.matches != null ? nearest.matches - previous.matches : null;

        const px = toX(nearest.time);
        const py = toY(nearest.elo);
        cursor.setAttribute("x1", px);
        cursor.setAttribute("x2", px);
        cursorDot.setAttribute("cx", px);
        cursorDot.setAttribute("cy", py);
        cursor.hidden = false;
        cursorDot.hidden = false;

        tooltip.innerHTML = `
          <span>${escapeHtml(rrFullTime(nearest.time))}${nearest.act ? `, ${escapeHtml(nearest.act)}` : ""}</span>
          <strong>${escapeHtml(nearest.rank)} <b>${num(nearest.rr)} RR</b></strong>
          ${delta != null
            ? `<em class="${delta > 0 ? "good-stat" : delta < 0 ? "bad-stat" : ""}">${delta > 0 ? "+" : ""}${delta} RR${games ? ` over ${games} ${games === 1 ? "match" : "matches"}` : ""}</em>`
            : `<em>${previous ? "Start of act" : "Tracking started"}</em>`}
        `;
        tooltip.hidden = false;
        const left = (px / box.width) * rect.width;
        const top = (py / box.height) * rect.height;
        tooltip.style.left = `${Math.min(Math.max(left, 80), rect.width - 80)}px`;
        tooltip.style.top = `${top}px`;
        tooltip.classList.toggle("below", top < 70);
      };

      const hide = () => {
        tooltip.hidden = true;
        cursor.hidden = true;
        cursorDot.hidden = true;
      };

      hit.addEventListener("pointermove", show);
      hit.addEventListener("pointerdown", show);
      hit.addEventListener("pointerleave", hide);
    };

    block.querySelectorAll(".rr-range").forEach((button) => {
      button.addEventListener("click", () => {
        range = button.dataset.range;
        block.querySelectorAll(".rr-range").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
        block.querySelector(".rr-body").innerHTML = renderRrChart(points, range, chartId);
        attachHover();
      });
    });

    attachHover();
  });
}

const PARTY_KEYS = [
  "matches", "wins", "losses", "draws", "rounds", "rounds_won",
  "time_played_ms", "score", "kills", "deaths", "assists",
  "headshots", "bodyshots", "legshots",
  "damage_dealt", "damage_received", "kast_rounds",
  "first_bloods", "first_deaths",
  "performance_score_total", "performance_score_matches",
];

function partySummary(t) {
  const shots = num(t.headshots) + num(t.bodyshots) + num(t.legshots);
  return {
    matches: num(t.matches),
    wins: num(t.wins),
    losses: num(t.losses),
    draws: num(t.draws),
    winrate: ratio(num(t.wins), num(t.matches), 1, 100),
    acs: ratio(num(t.score), num(t.rounds), 1),
    adr: ratio(num(t.damage_dealt), num(t.rounds), 1),
    kd: num(t.matches) ? ratio(num(t.kills), Math.max(num(t.deaths), 1), 2) : null,
    kast: ratio(num(t.kast_rounds), num(t.rounds), 1, 100),
    hs: ratio(num(t.headshots), shots, 1, 100),
    performance: ratio(num(t.performance_score_total), num(t.performance_score_matches), 1),
    firstBloods: ratio(num(t.first_bloods), num(t.matches), 2),
  };
}

function mergeParty(target, source) {
  if (!source) return target;
  Object.entries(source.by_size || {}).forEach(([size, totals]) => {
    target.by_size[size] = mergeCounts(target.by_size[size] || {}, totals);
  });
  Object.entries(source.friends || {}).forEach(([friend, pair]) => {
    const entry = target.friends[friend] || (target.friends[friend] = { me: {}, them: {} });
    mergeCounts(entry.me, pair.me);
    mergeCounts(entry.them, pair.them);
  });
  return target;
}

// The player list currently on screen, used to colour friends by rank.
let activePlayers = [];

function renderPartyTab(player) {
  const party = player.party;
  if (!party || !Object.keys(party.by_size || {}).length) {
    return notYetTracked(player, "Party stats");
  }

  const overallWinrate = partySummary(Object.values(party.by_size).reduce((all, t) => mergeCounts(all, t), {})).winrate;

  const sizeRows = Object.entries(party.by_size)
    .map(([size, totals]) => [Number(size), partySummary(totals)])
    .filter(([, s]) => s.matches > 0)
    .sort((a, b) => a[0] - b[0])
    .map(([size, s]) => `
      <tr>
        <th scope="row">${partyName(size)}</th>
        <td>${s.matches}</td>
        <td>${formatRecord(s.wins, s.losses, s.draws)}</td>
        <td class="${s.winrate > overallWinrate ? "good-stat" : s.winrate < overallWinrate ? "bad-stat" : ""}">${modalPercent(s.winrate)}</td>
        <td>${fixedNumber(s.acs, 1)}</td>
        <td>${fixedNumber(s.kd, 2)}</td>
        <td>${modalPercent(s.kast)}</td>
        <td>${fixedNumber(s.adr, 1)}</td>
        <td>${fixedNumber(s.performance, 1)}</td>
      </tr>
    `).join("");

  const sizeTable = `
    <div class="table-scroll">
      <table class="modal-table party-table">
        <thead>
          <tr><th>Queue</th><th>Matches</th><th>W–L</th><th>Win %</th><th>ACS</th><th>K/D</th><th>KAST</th><th>ADR</th><th>Performance</th></tr>
        </thead>
        <tbody>${sizeRows}</tbody>
      </table>
    </div>
    <p class="modal-footnote">Win rates in green or red are above or below this player's ${modalPercent(overallWinrate)} across all queues.</p>
  `;

  const friendStats = [
    ["ACS", "acs", fixedNumber, 1],
    ["K/D", "kd", fixedNumber, 2],
    ["KAST", "kast", (v) => modalPercent(v)],
    ["ADR", "adr", fixedNumber, 1],
    ["Headshot %", "hs", (v) => modalPercent(v)],
    ["First bloods / match", "firstBloods", fixedNumber, 2],
    ["Avg performance", "performance", fixedNumber, 1],
  ];

  const friends = Object.entries(party.friends || {})
    .map(([id, pair]) => ({ id, me: partySummary(pair.me), them: partySummary(pair.them) }))
    .filter((f) => f.me.matches > 0)
    .sort((a, b) => b.me.matches - a.me.matches);

  const friendCards = friends.map((f) => {
    const friendPlayer = activePlayers.find((p) => p.id === f.id);
    const tally = { a: 0, b: 0 };
    const rows = friendStats.map(([label, key, format, digits]) => {
      const va = finite(f.me[key]);
      const vb = finite(f.them[key]);
      const winner = compareWinner(va, vb, "high");
      if (winner === "a" || winner === "b") tally[winner] += 1;
      return compareRow(label, format(va, digits), format(vb, digits), { va, vb, winner });
    }).join("");

    return `
      <article class="friend-card" data-tier="${rankTier(friendPlayer?.rank)}">
        <header class="friend-head">
          <div class="friend-side">
            <strong>${escapeHtml(player.id)}</strong>
            <small>${tally.a} of ${friendStats.length} stats ahead</small>
          </div>
          <div class="friend-together">
            <b>${f.me.matches}</b>
            <span>${f.me.matches === 1 ? "match" : "matches"} together</span>
            <small class="${f.me.winrate > overallWinrate ? "good-stat" : f.me.winrate < overallWinrate ? "bad-stat" : ""}">${formatRecord(f.me.wins, f.me.losses, f.me.draws)}, ${modalPercent(f.me.winrate, 0)} won</small>
          </div>
          <div class="friend-side friend-them">
            <strong>${escapeHtml(f.id)}</strong>
            <small>${tally.b} of ${friendStats.length} stats ahead</small>
          </div>
        </header>
        <div class="friend-rows">${rows}</div>
      </article>
    `;
  }).join("");

  return `
    ${modalSection("By queue size", "Every match this period, split by how many players queued together", sizeTable)}
    ${modalSection("With friends", friends.length
      ? `${player.id}'s performance next to each tracked friend's, in the matches they queued together`
      : "", friends.length
      ? `<div class="friend-list">${friendCards}</div>`
      : `<p class="modal-empty">No matches queued with other tracked players yet.</p>`)}
  `;
}

const RANK_TIERS = ["iron", "bronze", "silver", "gold", "platinum", "diamond", "ascendant", "immortal", "radiant"];

function rankTier(rank) {
  const tier = String(rank || "").trim().split(/\s+/)[0].toLowerCase();
  return RANK_TIERS.includes(tier) ? tier : "unrated";
}

function cardStat(label, value, options = {}) {
  return `
    <div${options.className ? ` class="${options.className}"` : ""}>
      <dt>${escapeHtml(label)}</dt>
      <dd>${escapeHtml(value)}</dd>
      ${options.was ? `<span class="card-was">was ${escapeHtml(options.was)}</span>` : ""}
    </div>
  `;
}

function renderPlayerCard(player, view) {
  const { act, sortKey, old } = view;
  const score = getDisplayedValoStatScore(player, act);

  // "was ..." notes appear only in the changes view, and only for values that moved.
  const was = (current, previous) => (old && previous !== current ? previous : "");

  const stats = CARD_STATS.map((key) => {
    const stat = STAT_BY_KEY[key];
    const text = statText(stat, player, act);
    return cardStat(stat.short || stat.label, text, {
      className: key === sortKey ? "is-sorted" : "",
      was: old ? was(text, statText(stat, old, act)) : "",
    });
  }).join("");

  // When sorting by a stat that isn't on the card, show it as an extra row.
  const sortStat = STAT_BY_KEY[sortKey];
  const focus = sortStat && !CARD_STATS.includes(sortKey) && sortKey !== "score" && sortKey !== "rank"
    ? cardStat(sortStat.label, statText(sortStat, player, act), { className: "card-stat-focus" })
    : "";

  const rankText = `${player.rank || "Unrated"}`;
  const oldRank = old ? `${old.rank || "Unrated"}, ${num(old.rr)} RR` : "";
  const rankChanged = old && (old.rank !== player.rank || old.rr !== player.rr);

  const oldScore = old ? formatScore(valoStatScore(old)) : "";
  const scoreLabel = act === "overall" && player.actCount > 1
    ? `ValoStat score, average of ${player.actCount} acts`
    : old && oldScore !== formatScore(score)
      ? `ValoStat score, was ${oldScore}`
      : "ValoStat score";

  return `
    <article class="card${old ? " diff-highlight" : ""}${sortKey === "score" ? " sorted-by-score" : ""}" data-tier="${rankTier(player.rank)}" data-player-id="${escapeHtml(player.id)}" tabindex="0" aria-label="${escapeHtml(player.id)}, open full stats">
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

      <div class="card-rank${sortKey === "rank" ? " is-sorted" : ""}">
        <strong>${escapeHtml(rankText)}</strong>
        <span>${escapeHtml(player.rr ?? 0)} RR</span>
        ${rankChanged ? `<span class="card-was">was ${escapeHtml(oldRank)}</span>` : ""}
      </div>

      <dl class="card-stats">
        ${stats}
        ${focus}
      </dl>

      ${renderFormStrip(player)}

      <div class="score">
        <span class="score-value">${escapeHtml(formatScore(score))}</span>
        ${scoreMeter(score)}
        <span class="score-label">${escapeHtml(scoreLabel)}</span>
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

  activePlayers = displayData;
  updateSortAvailability(displayData, act);
  const sortType = document.getElementById("sortSelect").value;
  const sortStat = STAT_BY_KEY[sortType];

  if (sortStat) {
    sortPlayers(displayData, sortStat, act);
  }

  // The minimum-matches filter only applies while a stat is being sorted,
  // so a handful of games can't top a ranking.
  const minMatches = sortStat ? getMinMatches() : 0;
  const shown = minMatches
    ? displayData.filter((player) => num(player.matches) >= minMatches)
    : displayData;
  const hiddenCount = displayData.length - shown.length;

  updateMinMatchesControl(Boolean(sortStat));
  syncUrlState();

  profiles.innerHTML = "";

  if (showDiff && prev.length > 0 && !prev.some((player) => player.diff)) {
    profiles.innerHTML = "<p class='no-changes'>No changes since last update.</p>";
    return displayData;
  }

  const cards = [];

  if (hiddenCount) {
    cards.push(`<p class="grid-note">${hiddenCount} ${hiddenCount === 1 ? "player" : "players"} with fewer than ${minMatches} matches ${hiddenCount === 1 ? "is" : "are"} hidden.</p>`);
  }

  shown.forEach((player) => {
    const playerKey = getPlayerMatchKey(player);
    const playerDiff = prev.find((item) => item.key === playerKey);

    if (showDiff && playerDiff && !playerDiff.diff) return;

    cards.push(renderPlayerCard(player, {
      act,
      sortKey: sortStat ? sortType : null,
      old: showDiff && playerDiff?.diff ? playerDiff.old : null,
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

// Which side wins: "a", "b", "tie", or null when there's no winner.
function compareWinner(va, vb, better) {
  if (!better || va == null || vb == null) return null;
  if (va === vb) return "tie";
  const aHigher = va > vb;
  return (better === "high") === aHigher ? "a" : "b";
}

function compareRow(label, a, b, options = {}) {
  const { va, vb, winner, note } = options;
  const max = Math.max(Math.abs(va ?? 0), Math.abs(vb ?? 0));
  const width = (value) => (value == null || !max ? 0 : (Math.abs(value) / max) * 100);
  const side = (who) => {
    if (winner === "tie") return "equal-stat";
    if (!winner) return "";
    return winner === who ? "good-stat" : "bad-stat";
  };

  return `
    <div class="cmp-row" data-winner="${winner || "none"}">
      <span class="cmp-val cmp-a ${side("a")}">${escapeHtml(a)}</span>
      <span class="cmp-bar cmp-bar-a ${side("a")}"><i style="width:${width(va)}%"></i></span>
      <span class="cmp-label">${escapeHtml(label)}${note ? `<small>${escapeHtml(note)}</small>` : ""}</span>
      <span class="cmp-bar cmp-bar-b ${side("b")}"><i style="width:${width(vb)}%"></i></span>
      <span class="cmp-val cmp-b ${side("b")}">${escapeHtml(b)}</span>
    </div>
  `;
}

function renderComparison(a, b) {
  const act = currentAct;
  const tally = { a: 0, b: 0, tie: 0 };
  const count = (winner) => {
    if (winner) tally[winner] += 1;
    return winner;
  };

  // Rank first. RR only decides anything when both players hold the same rank.
  const rankA = rankValue(a.rank);
  const rankB = rankValue(b.rank);
  const sameRank = rankA === rankB;
  const rankRows = [
    compareRow("Rank", a.rank || "Unrated", b.rank || "Unrated", {
      va: rankA, vb: rankB, winner: count(compareWinner(rankA, rankB, "high")),
    }),
    compareRow("RR", `${num(a.rr)}`, `${num(b.rr)}`, {
      va: num(a.rr), vb: num(b.rr),
      winner: sameRank ? count(compareWinner(num(a.rr), num(b.rr), "high")) : null,
      note: sameRank ? "" : "Only compared within the same rank",
    }),
  ];

  const groups = STAT_GROUPS.map((group) => {
    const rows = STATS
      .filter((stat) => stat.group === group && stat.compare)
      .map((stat) => {
        const va = statValue(stat, a, act);
        const vb = statValue(stat, b, act);
        if (va == null && vb == null) return "";
        return compareRow(stat.label, stat.format(va, a), stat.format(vb, b), {
          va, vb, winner: count(compareWinner(va, vb, stat.better)),
        });
      })
      .filter(Boolean);

    if (group === "General") rows.unshift(...rankRows);
    if (group === "General" && act === "overall") {
      rows.push(compareRow("Acts counted", `${a.actCount || 1}`, `${b.actCount || 1}`, {
        va: a.actCount || 1, vb: b.actCount || 1, winner: null,
      }));
    }
    if (!rows.length) return "";

    return `
      <section class="cmp-group">
        <h3>${escapeHtml(group)}</h3>
        ${rows.join("")}
      </section>
    `;
  }).join("");

  const headline = (player, side) => `
    <div class="cmp-player cmp-player-${side}" data-tier="${rankTier(player.rank)}">
      <strong>${escapeHtml(player.id)}</strong>
      <span>${escapeHtml(player.rank || "Unrated")}</span>
      <b>${tally[side]}</b>
      <small>stats won</small>
    </div>
  `;

  comparison.innerHTML = `
    <div class="cmp-head">
      ${headline(a, "a")}
      <div class="cmp-vs">
        <span>vs</span>
        ${tally.tie ? `<small>${tally.tie} tied</small>` : ""}
      </div>
      ${headline(b, "b")}
    </div>
    ${groups}
    <p class="modal-footnote">Bars show each value relative to the larger of the two. Stats where neither side is better, like credits spent or average enemy rank, aren't counted.</p>
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

/* ------------------ Minimum matches and shareable views ------------------ */

function getMinMatches() {
  const input = document.getElementById("minMatches");
  const value = Math.floor(Number(input?.value));
  return Number.isFinite(value) && value > 0 ? value : 0;
}

function updateMinMatchesControl(visible) {
  const control = document.getElementById("minMatchesControl");
  if (control) control.hidden = !visible;
}

// The act, sort, direction and minimum matches live in the URL, so a link
// reopens the same view.
function syncUrlState() {
  if (isPlayerPage) return;
  const params = new URLSearchParams();
  const sort = document.getElementById("sortSelect").value;

  if (currentAct !== actsConfig.current) params.set("act", currentAct);
  if (sort !== "default") {
    params.set("sort", sort);
    const stat = STAT_BY_KEY[sort];
    const defaultDirection = stat?.better === "low" ? "asc" : "desc";
    if (sortDirection !== defaultDirection) params.set("dir", sortDirection);
    if (getMinMatches()) params.set("min", String(getMinMatches()));
  }

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ""}`;
  if (url !== `${window.location.pathname}${window.location.search}`) {
    window.history.replaceState(null, "", url);
  }
}

function readUrlState() {
  const params = new URLSearchParams(window.location.search);
  const act = params.get("act");
  const knownAct = act === "overall" || actsConfig.acts.some((item) => item.code === act);
  if (act && knownAct) currentAct = act;

  const sort = params.get("sort");
  const stat = STAT_BY_KEY[sort];
  if (stat) {
    document.getElementById("sortSelect").value = sort;
    sortDirection = params.get("dir") === "asc" || params.get("dir") === "desc"
      ? params.get("dir")
      : stat.better === "low" ? "asc" : "desc";
  }

  const min = Math.floor(Number(params.get("min")));
  if (Number.isFinite(min) && min > 0) {
    document.getElementById("minMatches").value = String(min);
  }
}

// Start a comparison from a player's popup.
function compareFromModal(playerId) {
  const modal = document.getElementById("cardModal");
  closeCardModal({ restoreFocus: false });

  selectA.value = playerId;
  if (selectB.value === playerId) {
    const other = [...selectB.options].find((option) => option.value !== playerId);
    if (other) selectB.value = other.value;
  }

  const section = document.querySelector(".compare-section");
  section?.scrollIntoView({ behavior: "smooth", block: "start" });
  onCompareClick();
  selectB.focus({ preventScroll: true });
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
  activePlayers = data;
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
  bindRrCharts(root, player);
  bindAgentControls(root, player);
}

/* ------------------ Dashboard (index.html) ------------------ */

function initDashboard() {
  currentAct = actsConfig.current;
  buildSortMenu();
  readUrlState();
  buildActNav();

  compareBtn.addEventListener("click", onCompareClick);

  document.getElementById("highlightsToggle")?.addEventListener("click", (event) => {
    const toggle = event.currentTarget;
    const open = toggle.getAttribute("aria-expanded") !== "true";
    toggle.setAttribute("aria-expanded", String(open));
    document.getElementById("highlightsPanel").hidden = !open;
    toggle.closest(".highlights").classList.toggle("is-open", open);
  });

  document.getElementById("highlightGrid")?.addEventListener("click", (event) => {
    const button = event.target.closest(".highlight-player");
    if (!button) return;
    const player = cache.find((item) => item.id === button.dataset.playerId);
    if (player) openCardModal(player, actsConfig.current);
  });

  let minMatchesTimer = null;
  document.getElementById("minMatches").addEventListener("input", () => {
    clearTimeout(minMatchesTimer);
    minMatchesTimer = setTimeout(() => renderCards(), 250);
  });

  document.getElementById("sortSelect").addEventListener("change", async (event) => {
    // A new stat starts with its better end first (fewest deaths, most kills).
    const stat = STAT_BY_KEY[event.target.value];
    sortDirection = stat?.better === "low" ? "asc" : "desc";
    updateSortDirectionButton();
    await renderCards();
  });

  document.getElementById("sortDirection").addEventListener("click", async () => {
    sortDirection = sortDirection === "desc" ? "asc" : "desc";
    updateSortDirectionButton();
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
  loadAgentCatalog();
  await loadActsConfig();
  if (isPlayerPage) {
    await initPlayerPage();
  } else {
    await initDashboard();
  }
}

init();
