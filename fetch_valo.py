import requests
import json
import os
import re
import time
from datetime import datetime, timedelta, timezone

API_KEY = os.environ["HENRIK_API_KEY"]
HEADERS = {"Authorization": API_KEY}

REGION = "ap"
PLATFORM = "pc"
# The current act and the list of acts shown on the site live in acts.json.
# When the MMR data shows a newer act, this script archives stats.json to
# data/<old act>.json and switches acts.json to the new act by itself.
ACTS_FILE = "acts.json"
DEFAULT_ACTS = {
    "current": "e11a6",
    "acts": [
        {"code": "e11a6", "label": "V26: A6"},
        {"code": "e11a5", "label": "V26: A5"},
        {"code": "e11a4", "label": "V26: A4"},
        {"code": "e11a3", "label": "V26: A3"},
        {"code": "e11a2", "label": "V26: A2"},
    ],
}
CURRENT_ACT = None  # set from acts.json in main

# Bump this when the shape of the stored totals changes. A player entry saved
# with an older version is rebuilt from scratch on the next run (its processed
# match list is discarded, so every match in the act is fetched again).
STATS_SCHEMA_VERSION = 3  # 3: party stats and recent matches

PLAYERS = {
    "Rishabh": "Rishabh4#Gamer",
    "Akshat": "Flashgaming4#FAST",
    "Advik": "NøVä#8790",
    "Modit": "Limitless065#5079",
    "Moksh": "CuteBoyMox#9710",
    "Nityaa": "LadyWhistledown#2310",
    "Vandna": "Fluxy#XOXO",
    "Timmy": "timmyy#latte",
    "Siddharth": "BravosidOP#India",
    "Hardik": "Livein#1234",
    "Tanmay": "KabruhSingh#Drunk",
    "Sonu": "reducto#12432",
    "Anshul": "AnShu1#GhOul",
    "Dhimanth": "DeeKay#6875",
    "Shivansh": "SILVERBOLT#008",
    "Eklavya": "MadLiberator2005#9683",
    "Aryan": "TheChosenOne#2205",
    "Yash": "yashkali997#kali",
    "Ria": "Ria4#2222",
    "Ria_alt": "Ria4#4444",
    "Bodit": "Limited065#8643",
    "Ritwik": "RITWIK#6493",
}

LAST_REQUEST_TIME = 0
MIN_INTERVAL = 100 / 28  # about 3.57 seconds between requests

# A death counts as traded if a teammate kills the killer within this window.
TRADE_WINDOW_MS = 5000

RANK_VALUES = {
    "Iron 1": 1, "Iron 2": 2, "Iron 3": 3,
    "Bronze 1": 4, "Bronze 2": 5, "Bronze 3": 6,
    "Silver 1": 7, "Silver 2": 8, "Silver 3": 9,
    "Gold 1": 10, "Gold 2": 11, "Gold 3": 12,
    "Platinum 1": 13, "Platinum 2": 14, "Platinum 3": 15,
    "Diamond 1": 16, "Diamond 2": 17, "Diamond 3": 18,
    "Ascendant 1": 19, "Ascendant 2": 20, "Ascendant 3": 21,
    "Immortal 1": 22, "Immortal 2": 23, "Immortal 3": 24,
    "Radiant": 25,
}

PERFORMANCE_BREAKDOWN_KEYS = (
    "damage", "trades", "assists", "utility_usage", "plants", "defuses",
    "adjusted_kills", "adjusted_deaths",
)

# Every counter below is summed match by match, both for the whole act and
# for each agent. Rates (ACS, ADR, KAST...) are derived from these at the end,
# so they always use matching numerators and denominators.
COUNTER_KEYS = (
    "matches", "wins", "losses", "draws",
    "rounds", "rounds_won",
    "time_played_ms",
    "score",                      # combat score total (ACS = score / rounds)
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
    # Enemy rank minus the player's own rank, per match (added without a
    # schema bump, so only matches fetched after this change count).
    "rank_delta_sum", "rank_delta_matches",
)

MAP_COUNTER_KEYS = ("matches", "wins", "losses", "draws", "rounds", "rounds_won")

# Smaller set of counters kept for party stats (by party size and per friend).
PARTY_COUNTER_KEYS = (
    "matches", "wins", "losses", "draws", "rounds", "rounds_won",
    "time_played_ms", "score", "kills", "deaths", "assists",
    "headshots", "bodyshots", "legshots",
    "damage_dealt", "damage_received", "kast_rounds",
    "first_bloods", "first_deaths",
    "performance_score_total", "performance_score_matches",
)

RECENT_MATCHES_KEPT = 10
# Compact log of every match from the last few days, for the
# last-24-hours highlights on the main page.
MATCH_LOG_DAYS = 2  # highlights cover the last 24 hours
RR_HISTORY_KEPT = 1500  # about 3 months at several changes a day


def rate_limited_get(url):
    global LAST_REQUEST_TIME

    wait = MIN_INTERVAL - (time.time() - LAST_REQUEST_TIME)
    if wait > 0:
        time.sleep(wait)

    response = requests.get(url, headers=HEADERS, timeout=30)
    LAST_REQUEST_TIME = time.time()

    if response.status_code == 429:
        print("Rate limited. Sleeping 30s...")
        time.sleep(30)
        return rate_limited_get(url)

    response.raise_for_status()
    return response


# ---------------------------------------------------------------- API calls

def get_account(name, tag):
    url = f"https://api.henrikdev.xyz/valorant/v1/account/{name}/{tag}"
    return rate_limited_get(url).json()["data"]


def get_mmr(puuid):
    url = f"https://api.henrikdev.xyz/valorant/v3/by-puuid/mmr/{REGION}/{PLATFORM}/{puuid}"
    return rate_limited_get(url).json()["data"]


def get_matches(puuid, start=0, size=10):
    """Fetch one page of competitive matches. The API's start parameter is an index."""
    url = (
        f"https://api.henrikdev.xyz/valorant/v4/by-puuid/matches/"
        f"{REGION}/{PLATFORM}/{puuid}?mode=competitive&size={size}&start={start}"
    )
    return rate_limited_get(url).json().get("data", [])


def get_unprocessed_current_act_matches(puuid, current_act, processed_match_ids, expected_new_matches, page_size=10):
    """Page until we've retrieved the expected number of unseen matches for this act.

    The MMR season game count tells us how many matches we should need. We still
    check each page's act and match ID, because the recent-match feed can include
    matches from another act and/or IDs that have already been processed.
    """
    if expected_new_matches <= 0:
        return []

    collected = []
    seen_this_run = set()
    start = 0
    current_key = act_key(current_act)
    reached_older_act = False

    while len(collected) < expected_new_matches and not reached_older_act:
        page = get_matches(puuid, start=start, size=page_size)
        if not page:
            break

        for match in page:
            metadata = match.get("metadata", {})
            match_id = metadata.get("match_id")
            act = (metadata.get("season") or {}).get("short")
            # The feed is newest first, so once it reaches an earlier act
            # there are no more current-act matches to find. Without this,
            # a player whose season game count is ahead of what the API
            # returns would have their whole history paged every run.
            key = act_key(act)
            if current_key and key and key < current_key:
                reached_older_act = True
            if (
                match_id
                and act == current_act
                and match_id not in processed_match_ids
                and match_id not in seen_this_run
            ):
                collected.append(match)
                seen_this_run.add(match_id)
                if len(collected) >= expected_new_matches:
                    break

        # Use the actual page length for the next index. A short page means
        # the endpoint has no more results to return.
        start += len(page)
        if len(page) < page_size:
            break

    return collected


def get_accolades(puuid):
    url = (
        f"https://api.henrikdev.xyz/valorant/v1/by-puuid/accolades/"
        f"{REGION}/{PLATFORM}/{puuid}"
    )
    return rate_limited_get(url).json()["data"]


def resolve_player_identity(pid, riot, old_data_map):
    old = old_data_map.get(pid, {})
    puuid = old.get("puuid")
    banner = old.get("banner")

    # Keep the existing banner URL if we already have one. Match data only has
    # the card UUID, not the small-banner image URL expected by script.js.
    if puuid and banner:
        return puuid, banner, None

    name, tag = riot.split("#", 1)
    account = get_account(name, tag)
    return puuid or account["puuid"], account.get("card", {}).get("small", banner), account


# ------------------------------------------------------------ totals helpers

def num(value):
    """Numeric value or 0. Null in the API means 'did not happen' / not applicable."""
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) else 0


def empty_totals():
    totals = {key: 0 for key in COUNTER_KEYS}
    totals["performance_breakdown_totals"] = {key: 0.0 for key in PERFORMANCE_BREAKDOWN_KEYS}
    totals["performance_grades"] = {}
    totals["performance_ratings"] = {"combat": {}, "utility": {}}
    totals["maps"] = {}
    return totals


def normalize_totals(existing):
    """Load stored totals, filling any keys added since they were written."""
    result = empty_totals()
    if not isinstance(existing, dict):
        return result
    for key in COUNTER_KEYS:
        result[key] = num(existing.get(key))
    for key in PERFORMANCE_BREAKDOWN_KEYS:
        result["performance_breakdown_totals"][key] = num(
            (existing.get("performance_breakdown_totals") or {}).get(key)
        )
    result["performance_grades"] = dict(existing.get("performance_grades") or {})
    for group in ("combat", "utility"):
        stored = (existing.get("performance_ratings") or {}).get(group) or {}
        result["performance_ratings"][group] = {metric: dict(counts) for metric, counts in stored.items()}
    for map_name, map_totals in (existing.get("maps") or {}).items():
        result["maps"][map_name] = {key: num((map_totals or {}).get(key)) for key in MAP_COUNTER_KEYS}
    return result


def add_match(totals, match_stats):
    """Add one analysed match (from analyse_match) into a totals dict."""
    for key in COUNTER_KEYS:
        totals[key] += match_stats["counters"].get(key, 0)

    for key, value in match_stats["breakdown"].items():
        totals["performance_breakdown_totals"][key] += value

    grade = match_stats["grade"]
    if grade:
        totals["performance_grades"][grade] = totals["performance_grades"].get(grade, 0) + 1

    for group, metrics in match_stats["ratings"].items():
        for metric, rating in metrics.items():
            bucket = totals["performance_ratings"].setdefault(group, {}).setdefault(metric, {})
            bucket[rating] = bucket.get(rating, 0) + 1

    map_name = match_stats["map"]
    if map_name:
        map_totals = totals["maps"].setdefault(map_name, {key: 0 for key in MAP_COUNTER_KEYS})
        for key in MAP_COUNTER_KEYS:
            map_totals[key] += match_stats["counters"].get(key, 0)


def ratio(numerator, denominator, digits=2, scale=1):
    return round(numerator / denominator * scale, digits) if denominator else None


def derive_summary(t):
    """Rates and averages derived from a totals dict. None means no data."""
    rounds = t["rounds"]
    matches = t["matches"]
    shots = t["headshots"] + t["bodyshots"] + t["legshots"]
    perf_matches = t["performance_score_matches"]

    return {
        "matches": matches,
        "wins": t["wins"],
        "losses": t["losses"],
        "draws": t["draws"],
        "winrate": ratio(t["wins"], matches, 1, 100),
        "rounds": rounds,
        "round_winrate": ratio(t["rounds_won"], rounds, 1, 100),
        "time_played_ms": t["time_played_ms"],

        "acs": ratio(t["score"], rounds, 1),
        "adr": ratio(t["damage_dealt"], rounds, 1),
        "dd_delta": ratio(t["damage_dealt"] - t["damage_received"], rounds, 1),
        "kd": ratio(t["kills"], max(t["deaths"], 1), 2) if matches else None,
        "kad": ratio(t["kills"] + t["assists"], max(t["deaths"], 1), 2) if matches else None,
        "kast": ratio(t["kast_rounds"], rounds, 1, 100),
        "hs_percent": ratio(t["headshots"], shots, 1, 100),
        "kills_per_match": ratio(t["kills"], matches, 2),
        "deaths_per_match": ratio(t["deaths"], matches, 2),
        "assists_per_match": ratio(t["assists"], matches, 2),
        "kills_per_round": ratio(t["kills"], rounds, 2),

        "first_bloods": t["first_bloods"],
        "first_deaths": t["first_deaths"],
        # Share of opening duels won: first bloods / (first bloods + first deaths).
        "opening_duel_winrate": ratio(t["first_bloods"], t["first_bloods"] + t["first_deaths"], 1, 100),
        "trade_kills": t["trade_kills"],
        "traded_deaths": t["traded_deaths"],
        "multikills": {
            "2k": t["multikills_2k"],
            "3k": t["multikills_3k"],
            "4k": t["multikills_4k"],
            "5k": t["aces"],
        },
        "clutches": t["clutches"],
        "plants": t["plants"],
        "defuses": t["defuses"],
        "match_mvps": t["match_mvps"],
        "team_mvps": t["team_mvps"],

        "ability_casts_per_round": {
            "grenade": ratio(t["ability_grenade"], rounds, 2),
            "ability_1": ratio(t["ability_1"], rounds, 2),
            "ability_2": ratio(t["ability_2"], rounds, 2),
            "ultimate": ratio(t["ability_ultimate"], rounds, 2),
        },
        "ultimates_per_match": ratio(t["ability_ultimate"], matches, 2),
        "avg_spent_per_round": ratio(t["economy_spent"], rounds, 0),
        "avg_loadout_per_round": ratio(t["loadout_value"], rounds, 0),

        "avg_performance_score": ratio(t["performance_score_total"], perf_matches, 2),
        # The API's breakdown values are already per-round rates for one match;
        # this is their average across matches (null counted as 0).
        "performance_breakdown_averages": {
            key: ratio(t["performance_breakdown_totals"][key], perf_matches, 3)
            for key in PERFORMANCE_BREAKDOWN_KEYS
        },
        "enemy_rank_average_value": ratio(t["enemy_rank_sum"], t["enemy_rank_matches"], 2),
        "lobby_rank_average_value": ratio(t["lobby_rank_sum"], t["lobby_rank_matches"], 2),
        "rank_delta_average": ratio(t["rank_delta_sum"], t["rank_delta_matches"], 2),
        "rank_delta_matches": t["rank_delta_matches"],

        "maps": {
            map_name: {
                **m,
                "winrate": ratio(m["wins"], m["matches"], 1, 100),
                "round_winrate": ratio(m["rounds_won"], m["rounds"], 1, 100),
            }
            for map_name, m in sorted(t["maps"].items(), key=lambda item: -item[1]["matches"])
        },
    }


# ----------------------------------------------------------- match analysis

def analyse_match(match, puuid):
    """Everything this project tracks for one player in one match.

    Returns None if the player isn't in the match or the match has no rounds.
    """
    metadata = match.get("metadata") or {}
    rounds = match.get("rounds") or []
    if not rounds:
        return None

    player = next((p for p in match.get("players") or [] if p.get("puuid") == puuid), None)
    if not player:
        return None

    team_id = player.get("team_id")
    stats = player.get("stats") or {}
    damage = stats.get("damage") or {}
    abilities = player.get("ability_casts") or {}
    economy = player.get("economy") or {}
    behavior = player.get("behavior") or {}
    performance = player.get("performance") or {}

    # Result. A draw is when neither team is marked as the winner.
    teams = match.get("teams") or []
    my_team = next((t for t in teams if t.get("team_id") == team_id), {}) or {}
    any_team_won = any(t.get("won") for t in teams)
    won = bool(my_team.get("won"))
    draw = not any_team_won
    rounds_won = (my_team.get("rounds") or {}).get("won")
    if not isinstance(rounds_won, int):
        rounds_won = sum(1 for r in rounds if r.get("winning_team") == team_id)

    # Round ids from the API start at 0.
    round_ids = [r.get("id", index) for index, r in enumerate(rounds)]

    kills_by_round = {}
    for kill in match.get("kills") or []:
        kills_by_round.setdefault(kill.get("round"), []).append(kill)
    for events in kills_by_round.values():
        events.sort(key=lambda k: num(k.get("time_in_round_in_ms")))

    def pid(side):
        return (side or {}).get("puuid")

    def team_of(side):
        return (side or {}).get("team")

    kast_rounds = first_bloods = first_deaths = 0
    trade_kills = traded_deaths = 0
    multikills = {2: 0, 3: 0, 4: 0}
    aces = 0

    for round_id in round_ids:
        events = kills_by_round.get(round_id, [])
        got_kill = got_assist = died = traded = False
        round_kills = 0

        if events:
            if pid(events[0].get("killer")) == puuid:
                first_bloods += 1
            if pid(events[0].get("victim")) == puuid:
                first_deaths += 1

        for event in events:
            t = num(event.get("time_in_round_in_ms"))
            killer_id = pid(event.get("killer"))
            victim_id = pid(event.get("victim"))

            if killer_id == puuid:
                got_kill = True
                round_kills += 1
                # Trade kill: the victim had killed a teammate shortly before.
                if any(
                    pid(e.get("killer")) == victim_id
                    and team_of(e.get("victim")) == team_id
                    and pid(e.get("victim")) != puuid
                    and 0 <= t - num(e.get("time_in_round_in_ms")) <= TRADE_WINDOW_MS
                    for e in events
                ):
                    trade_kills += 1

            if any(pid(a) == puuid for a in event.get("assistants") or []):
                got_assist = True

            if victim_id == puuid:
                died = True
                # Traded death: a teammate killed our killer shortly after.
                if any(
                    pid(e.get("victim")) == killer_id
                    and team_of(e.get("killer")) == team_id
                    and 0 <= num(e.get("time_in_round_in_ms")) - t <= TRADE_WINDOW_MS
                    for e in events
                ):
                    traded = True

        if traded:
            traded_deaths += 1
        if got_kill or got_assist or not died or traded:
            kast_rounds += 1
        if round_kills >= 5:
            aces += 1
        elif round_kills >= 2:
            multikills[round_kills] += 1

    clutches = plants = defuses = 0
    for r in rounds:
        if r.get("ceremony") == "CeremonyClutch" and pid(r.get("ceremony_player")) == puuid:
            clutches += 1
        if pid((r.get("plant") or {}).get("player")) == puuid:
            plants += 1
        if pid((r.get("defuse") or {}).get("player")) == puuid:
            defuses += 1

    match_mvp = pid(metadata.get("mvp")) == puuid
    team_mvp = not match_mvp and pid(my_team.get("mvp")) == puuid

    # Average enemy rank uses the opposing team; lobby rank uses everyone with
    # a known tier. Unrated / unknown tiers are skipped, not treated as Iron 1.
    enemy_ranks, lobby_ranks = [], []
    for lobby_player in match.get("players") or []:
        value = RANK_VALUES.get((lobby_player.get("tier") or {}).get("name"))
        if value is None:
            continue
        lobby_ranks.append(value)
        if lobby_player.get("team_id") != team_id:
            enemy_ranks.append(value)

    perf_score = performance.get("score")
    has_perf = isinstance(perf_score, (int, float))
    breakdown = performance.get("breakdown") or {}
    ratings = performance.get("ratings") or {}

    counters = {
        "matches": 1,
        "wins": 1 if won else 0,
        "losses": 1 if not won and not draw else 0,
        "draws": 1 if draw else 0,
        "rounds": len(rounds),
        "rounds_won": rounds_won,
        # Match length. session_playtime_in_ms is the player's client session
        # length, not the match length, so it is not used.
        "time_played_ms": num(metadata.get("game_length_in_ms")),
        "score": num(stats.get("score")),
        "kills": num(stats.get("kills")),
        "deaths": num(stats.get("deaths")),
        "assists": num(stats.get("assists")),
        "headshots": num(stats.get("headshots")),
        "bodyshots": num(stats.get("bodyshots")),
        "legshots": num(stats.get("legshots")),
        "damage_dealt": num(damage.get("dealt")),
        "damage_received": num(damage.get("received")),
        "kast_rounds": kast_rounds,
        "first_bloods": first_bloods,
        "first_deaths": first_deaths,
        "trade_kills": trade_kills,
        "traded_deaths": traded_deaths,
        "multikills_2k": multikills[2],
        "multikills_3k": multikills[3],
        "multikills_4k": multikills[4],
        "aces": aces,
        "clutches": clutches,
        "plants": plants,
        "defuses": defuses,
        "match_mvps": 1 if match_mvp else 0,
        "team_mvps": 1 if team_mvp else 0,
        "ability_grenade": num(abilities.get("grenade")),
        "ability_1": num(abilities.get("ability1")),
        "ability_2": num(abilities.get("ability2")),
        "ability_ultimate": num(abilities.get("ultimate")),
        "economy_spent": num((economy.get("spent") or {}).get("overall")),
        "loadout_value": num((economy.get("loadout_value") or {}).get("overall")),
        "afk_rounds": num(behavior.get("afk_rounds")),
        "performance_score_total": perf_score if has_perf else 0,
        "performance_score_matches": 1 if has_perf else 0,
        "enemy_rank_sum": sum(enemy_ranks) / len(enemy_ranks) if enemy_ranks else 0,
        "enemy_rank_matches": 1 if enemy_ranks else 0,
        "lobby_rank_sum": sum(lobby_ranks) / len(lobby_ranks) if lobby_ranks else 0,
        "lobby_rank_matches": 1 if lobby_ranks else 0,
    }

    # Everyone sharing this player's party_id queued together (1 = solo).
    party_id = player.get("party_id")
    party_puuids = [
        p.get("puuid") for p in match.get("players") or []
        if party_id and p.get("party_id") == party_id and p.get("puuid") != puuid
    ]
    rounds_lost = (my_team.get("rounds") or {}).get("lost")
    if not isinstance(rounds_lost, int):
        rounds_lost = len(rounds) - rounds_won

    return {
        "tier_name": (player.get("tier") or {}).get("name"),
        "enemy_rank_value": sum(enemy_ranks) / len(enemy_ranks) if enemy_ranks else None,
        "lobby_rank_value": sum(lobby_ranks) / len(lobby_ranks) if lobby_ranks else None,
        "match_id": metadata.get("match_id"),
        "started_at": metadata.get("started_at"),
        "result": "draw" if draw else ("win" if won else "loss"),
        "rounds_won": rounds_won,
        "rounds_lost": rounds_lost,
        "party_size": min(len(party_puuids) + 1, 5),
        "party_puuids": party_puuids,
        "performance_score": perf_score if has_perf else None,
        "agent": (player.get("agent") or {}).get("name") or "Unknown",
        "map": (metadata.get("map") or {}).get("name"),
        "counters": counters,
        # Null breakdown values mean the action didn't happen, so they add 0.
        "breakdown": {key: num(breakdown.get(key)) for key in PERFORMANCE_BREAKDOWN_KEYS} if has_perf else {},
        "grade": ratings.get("grade") if has_perf else None,
        "ratings": {
            group: {metric: rating for metric, rating in (ratings.get(group) or {}).items() if rating is not None}
            for group in ("combat", "utility")
        } if has_perf else {},
        "account_level": player.get("account_level"),
        "card_id": (player.get("customization") or {}).get("card"),
    }


def own_rank_value(tier_name, started_at, rr_points, current_rank, current_rr):
    """The player's rank on the 1-25 scale plus RR as a fraction (Diamond 1,
    50 RR = 16.5) going into a match.

    Match data has the tier but not RR, so RR comes from the last RR history
    point before the match (if it was the same rank), else from the current
    rating (if the rank still matches), else the middle of the division.
    """
    base = RANK_VALUES.get(tier_name)
    if base is None:
        return None
    rr = None
    if started_at:
        earlier = [p for p in rr_points if (p.get("t") or "") <= started_at]
        if earlier and earlier[-1].get("rank") == tier_name:
            rr = earlier[-1].get("rr")
    if rr is None and current_rank == tier_name:
        rr = current_rr
    if not isinstance(rr, (int, float)):
        rr = 50
    return base + min(max(rr, 0), 99) / 100


def rank_delta(match_stats, own_value):
    """Average enemy rank minus the player's own rank, in divisions.

    Enemy RR isn't in the match data, so each enemy counts as the middle of
    their division (+0.5), the same way an unknown own RR is treated.
    Positive means the enemies were ranked higher.
    """
    enemy = match_stats.get("enemy_rank_value")
    if enemy is None or own_value is None:
        return None
    return (enemy + 0.5) - own_value


def empty_party_totals():
    return {key: 0 for key in PARTY_COUNTER_KEYS}


def normalize_party_totals(existing):
    return {key: num((existing or {}).get(key)) for key in PARTY_COUNTER_KEYS}


def add_party_match(target, match_stats):
    for key in PARTY_COUNTER_KEYS:
        target[key] += match_stats["counters"].get(key, 0)


def recent_match_entry(match_stats, puuid_to_id):
    """Compact record of one match for the recent matches list."""
    c = match_stats["counters"]
    return {
        "match_id": match_stats["match_id"],
        "started_at": match_stats["started_at"],
        "map": match_stats["map"],
        "agent": match_stats["agent"],
        "result": match_stats["result"],
        "rounds_won": match_stats["rounds_won"],
        "rounds_lost": match_stats["rounds_lost"],
        "kills": c["kills"],
        "deaths": c["deaths"],
        "assists": c["assists"],
        "acs": round(c["score"] / c["rounds"], 1) if c["rounds"] else None,
        "adr": round(c["damage_dealt"] / c["rounds"], 1) if c["rounds"] else None,
        "headshot_percent": round(c["headshots"] / (c["headshots"] + c["bodyshots"] + c["legshots"]) * 100, 1)
            if (c["headshots"] + c["bodyshots"] + c["legshots"]) else None,
        "performance_score": round(match_stats["performance_score"], 1)
            if match_stats["performance_score"] is not None else None,
        "grade": match_stats["grade"],
        "match_mvp": bool(c["match_mvps"]),
        "team_mvp": bool(c["team_mvps"]),
        "lobby_rank_value": round(match_stats["lobby_rank_value"], 2)
            if match_stats.get("lobby_rank_value") is not None else None,
        "enemy_rank_value": round(match_stats["enemy_rank_value"], 2)
            if match_stats.get("enemy_rank_value") is not None else None,
        "rank_delta": round(match_stats["rank_delta"], 2)
            if match_stats.get("rank_delta") is not None else None,
        "party_size": match_stats["party_size"],
        # Only friends tracked on the site are named.
        "party_with": [puuid_to_id[p] for p in match_stats["party_puuids"] if p in puuid_to_id],
    }


def match_log_entry(match):
    """Smallest record of a match needed for the highlights."""
    return {
        "match_id": match.get("match_id"),
        "t": match.get("started_at"),
        "result": match.get("result"),
        "rounds_won": match.get("rounds_won"),
        "rounds_lost": match.get("rounds_lost"),
        "kills": match.get("kills"),
        "deaths": match.get("deaths"),
        "assists": match.get("assists"),
        "acs": match.get("acs"),
        "performance_score": match.get("performance_score"),
        "match_mvp": match.get("match_mvp"),
        "team_mvp": match.get("team_mvp"),
        "agent": match.get("agent"),
        "map": match.get("map"),
    }


def current_act_accolades(puuid, fallback):
    try:
        accolades_data = get_accolades(puuid)
        for season in (accolades_data.get("summary") or {}).get("seasons") or []:
            if (season.get("season") or {}).get("short") == CURRENT_ACT:
                return season.get("accolades") or []
        return []
    except Exception as error:
        print(f"Could not fetch accolades for {puuid}: {error}")
        return fallback


# ------------------------------------------------------------ act changeover

# Valorant runs 6 acts a year. The site labels them by year and act
# ("V26: A6"); the API labels the same act by episode ("e11a6"). One episode
# is one year, so after e11a6 (V26: A6) comes e12a1 (V27: A1).
ACTS_PER_YEAR = 6


def act_key(code):
    """'e11a6' -> (11, 6); None for anything that isn't an act code."""
    match = re.fullmatch(r"e(\d+)a(\d+)", str(code or ""))
    return (int(match.group(1)), int(match.group(2))) if match else None


def next_act_code(code):
    """The act that follows `code`: e11a5 -> e11a6, e11a6 -> e12a1."""
    key = act_key(code)
    if not key:
        return None
    episode, act = key
    return f"e{episode}a{act + 1}" if act < ACTS_PER_YEAR else f"e{episode + 1}a1"


def label_for_new_act(previous_code, previous_label, new_code):
    """Derive a site label like 'V26: A6' for a new act from the previous one.

    Same episode keeps the 'V' number; a new episode bumps it. If the previous
    label doesn't follow that pattern, fall back to the act code. The label
    can always be edited by hand in acts.json.
    """
    previous, new = act_key(previous_code), act_key(new_code)
    label = re.fullmatch(r"V(\d+): A\d+", str(previous_label or ""))
    if not (previous and new and label):
        return new_code.upper()
    year = int(label.group(1)) + (1 if new[0] != previous[0] else 0)
    return f"V{year}: A{new[1]}"


def load_json(path, fallback):
    if not os.path.exists(path):
        return fallback
    with open(path, encoding="utf-8") as file:
        return json.load(file)


def write_json(path, data):
    folder = os.path.dirname(path)
    if folder:
        os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8") as file:
        json.dump(data, file, indent=2, ensure_ascii=False)


def switch_to_new_act(acts_config, new_act, old_data):
    """Archive the finished act and make new_act current in acts_config."""
    previous_act = acts_config["current"]
    archive_path = f"data/{previous_act}.json"
    previous_entries = [p for p in old_data if isinstance(p, dict) and p.get("season") == previous_act]

    if previous_entries and not os.path.exists(archive_path):
        write_json(archive_path, previous_entries)
        print(f"Archived {len(previous_entries)} players from {previous_act} to {archive_path}")
    elif os.path.exists(archive_path):
        print(f"{archive_path} already exists; leaving it as is")

    previous_label = next(
        (act.get("label") for act in acts_config["acts"] if act.get("code") == previous_act),
        None,
    )
    acts_config["current"] = new_act
    if not any(act.get("code") == new_act for act in acts_config["acts"]):
        acts_config["acts"].insert(0, {
            "code": new_act,
            "label": label_for_new_act(previous_act, previous_label, new_act),
        })
    write_json(ACTS_FILE, acts_config)

    # The "show changes" view compares against stats_prev.json, which now
    # belongs to the old act, so start it fresh.
    write_json("stats_prev.json", [])
    print(f"Switched current act from {previous_act} to {new_act}")


# --------------------------------------------------------------------- main

acts_config = load_json(ACTS_FILE, None)
if not acts_config:
    acts_config = json.loads(json.dumps(DEFAULT_ACTS))
    write_json(ACTS_FILE, acts_config)
CURRENT_ACT = acts_config["current"]

old_data = load_json("stats.json", [])
old_data_map = {item["id"]: item for item in old_data if isinstance(item, dict) and "id" in item}

# Pass 1: identity and MMR for every player. The MMR data also tells us
# whether a newer act has started.
identities = {}
for pid, riot in PLAYERS.items():
    try:
        puuid, banner, account = resolve_player_identity(pid, riot, old_data_map)
        identities[pid] = (puuid, banner, account, get_mmr(puuid))
    except Exception as error:
        identities[pid] = error
        print(f"Failed to load identity/MMR for {riot}: {error}")

seen_acts = {
    (item.get("season") or {}).get("short")
    for value in identities.values() if not isinstance(value, Exception)
    for item in (value[3].get("seasonal") or [])
}
# Only the act directly after the current one can start a changeover, so a
# stray or older season code in the MMR history never switches acts.
upcoming_act = next_act_code(CURRENT_ACT)
if upcoming_act and upcoming_act in seen_acts:
    switch_to_new_act(acts_config, upcoming_act, old_data)
    CURRENT_ACT = upcoming_act

# Tracked players by puuid, so party members can be matched to friends.
puuid_to_id = {
    value[0]: pid for pid, value in identities.items()
    if not isinstance(value, Exception) and value[0]
}

RUN_NOW = datetime.now(timezone.utc)
RUN_TIME = RUN_NOW.strftime("%Y-%m-%dT%H:%M:%SZ")
LOG_CUTOFF = (RUN_NOW - timedelta(days=MATCH_LOG_DAYS)).strftime("%Y-%m-%dT%H:%M:%SZ")

# Pass 2: matches and stats for the current act.
out = []

for pid, riot in PLAYERS.items():
    name, tag = riot.split("#", 1)
    print(f"Fetching {riot}")
    old = old_data_map.get(pid, {})

    # Entries from an older schema (or another act) are rebuilt from scratch.
    up_to_date = old.get("schema_version") == STATS_SCHEMA_VERSION and old.get("season") == CURRENT_ACT
    if old and not up_to_date:
        print(f"Stored entry for {riot} is from an older format or act; rebuilding this act's stats")

    try:
        identity = identities.get(pid)
        if isinstance(identity, Exception) or identity is None:
            raise identity or RuntimeError("identity was not loaded")
        puuid, banner, account, mmr = identity
        season = next(
            (item for item in mmr.get("seasonal", []) if item.get("season", {}).get("short") == CURRENT_ACT),
            None,
        )

        if not season:
            print(f"No MMR data for current act for {riot}; skipping")
            continue

        matches_played = season.get("games", 0) or 0

        current_tier = mmr.get("current") or {}
        current_rank = (current_tier.get("tier") or {}).get("name", old.get("rank", "Unrated"))
        current_rr = current_tier.get("rr", old.get("rr", 0))
        current_elo = current_tier.get("elo", old.get("elo", 0))
        previous_rr_points = list(old.get("rr_history") or []) if old.get("season") == CURRENT_ACT else []
        wins = season.get("wins", 0) or 0

        processed_match_ids = set(old.get("processed_matches", [])) if up_to_date else set()
        totals = normalize_totals(old.get("totals")) if up_to_date else empty_totals()
        agent_totals = {
            agent_name: normalize_totals(agent.get("totals"))
            for agent_name, agent in (old.get("agents") or {}).items()
        } if up_to_date else {}

        # Party stats: totals by party size (1 = solo ... 5 = five-stack), and
        # for each tracked friend, this player's and the friend's totals in
        # the matches they queued together.
        old_party = (old.get("party") or {}) if up_to_date else {}
        party_sizes = {
            size: normalize_party_totals(value)
            for size, value in (old_party.get("by_size") or {}).items()
        }
        party_friends = {
            friend: {
                "me": normalize_party_totals(value.get("me")),
                "them": normalize_party_totals(value.get("them")),
            }
            for friend, value in (old_party.get("friends") or {}).items()
        }
        recent = {m["match_id"]: m for m in (old.get("recent_matches") or []) if m.get("match_id")} if up_to_date else {}
        # The match log starts from the stored recent matches the first time.
        same_act = old.get("season") == CURRENT_ACT
        match_log = {
            m["match_id"]: m
            for m in (old.get("match_log") or [match_log_entry(r) for r in old.get("recent_matches") or []])
            if m.get("match_id")
        } if same_act else {}

        expected_new_matches = max(0, int(matches_played) - len(processed_match_ids))
        if expected_new_matches:
            matches = get_unprocessed_current_act_matches(
                puuid, CURRENT_ACT, processed_match_ids, expected_new_matches, page_size=10
            )
            print(f"Fetched {len(matches)} new matches for {riot} (expected {expected_new_matches})")
        else:
            matches = []
            print(f"No new matches for {riot}, skipping match fetch")

        latest_level = old.get("level", account.get("account_level", 0) if account else 0)
        latest_card_id = old.get("banner_card_id")
        new_matches_count = 0

        for match in matches:
            metadata = match.get("metadata") or {}
            match_id = metadata.get("match_id")
            act = (metadata.get("season") or {}).get("short")
            if not match_id or act != CURRENT_ACT or match_id in processed_match_ids:
                continue

            match_stats = analyse_match(match, puuid)
            if match_stats is None:
                print(f"Skipping match {match_id} for {riot} (no rounds or player missing)")
                continue

            own_value = own_rank_value(
                match_stats["tier_name"], match_stats["started_at"],
                previous_rr_points, current_rank, current_rr,
            )
            delta = rank_delta(match_stats, own_value)
            match_stats["rank_delta"] = delta
            match_stats["counters"]["rank_delta_sum"] = delta if delta is not None else 0
            match_stats["counters"]["rank_delta_matches"] = 1 if delta is not None else 0

            add_match(totals, match_stats)
            add_match(agent_totals.setdefault(match_stats["agent"], empty_totals()), match_stats)

            add_party_match(party_sizes.setdefault(str(match_stats["party_size"]), empty_party_totals()), match_stats)
            for friend_puuid in match_stats["party_puuids"]:
                friend_id = puuid_to_id.get(friend_puuid)
                if not friend_id or friend_id == pid:
                    continue
                friend_stats = analyse_match(match, friend_puuid)
                if friend_stats is None:
                    continue
                pair = party_friends.setdefault(friend_id, {"me": empty_party_totals(), "them": empty_party_totals()})
                add_party_match(pair["me"], match_stats)
                add_party_match(pair["them"], friend_stats)

            recent[match_id] = recent_match_entry(match_stats, puuid_to_id)
            match_log[match_id] = match_log_entry(recent[match_id])

            # The match feed is newest first, so only take level/card from the
            # newest match we see in this run.
            if new_matches_count == 0:
                if match_stats["account_level"] is not None:
                    latest_level = match_stats["account_level"]
                if match_stats["card_id"]:
                    latest_card_id = match_stats["card_id"]

            processed_match_ids.add(match_id)
            new_matches_count += 1

        if new_matches_count > 0 or not up_to_date:
            accolades_seasonal = current_act_accolades(puuid, old.get("accolades_seasonal", []))
        else:
            accolades_seasonal = old.get("accolades_seasonal", [])

        summary = derive_summary(totals)
        shots = totals["headshots"] + totals["bodyshots"] + totals["legshots"]

        agents_out = {}
        for agent_name, agent in sorted(agent_totals.items(), key=lambda item: -item[1]["matches"]):
            agent_summary = derive_summary(agent)
            agents_out[agent_name] = {
                # Flat fields read by the current script.js agent cards.
                "matches": agent["matches"],
                "kills": agent["kills"],
                "deaths": agent["deaths"],
                "assists": agent["assists"],
                "time_played_ms": agent["time_played_ms"],
                "headshot_percentage": agent_summary["hs_percent"],
                "average_performance_score": agent_summary["avg_performance_score"],
                # Full stats.
                "summary": agent_summary,
                "totals": agent,
            }

        # Newest matches first; started_at is an ISO timestamp, so it sorts as text.
        recent_matches = sorted(recent.values(), key=lambda m: m.get("started_at") or "", reverse=True)[:RECENT_MATCHES_KEPT]
        match_log_cutoff = LOG_CUTOFF
        match_log_out = sorted(
            (m for m in match_log.values() if (m.get("t") or "") >= match_log_cutoff),
            key=lambda m: m.get("t") or "",
            reverse=True,
        )

        # RR over time: one point each time the rating changes. Kept across
        # schema rebuilds within the same act.
        rr_history = list(old.get("rr_history") or []) if old.get("season") == CURRENT_ACT else []
        last_point = rr_history[-1] if rr_history else None
        if matches_played and (not last_point or last_point.get("elo") != current_elo or last_point.get("rank") != current_rank):
            rr_history.append({
                "t": RUN_TIME,
                "rank": current_rank,
                "rr": current_rr,
                "elo": current_elo,
                "matches": matches_played,
            })
        rr_history = rr_history[-RR_HISTORY_KEPT:]

        out.append({
            "schema_version": STATS_SCHEMA_VERSION,

            # Identity and account (fields script.js already uses).
            "id": pid,
            "riot_id": riot,
            "name": name,
            "level": latest_level,
            "banner": f"https://media.valorant-api.com/playercards/{latest_card_id}/displayicon.png" if latest_card_id else banner,
            "banner_card_id": latest_card_id,
            "puuid": puuid,
            "rank": current_rank,
            "rr": current_rr,
            "elo": current_elo,
            "season": CURRENT_ACT,

            # MMR is the source of truth for games and wins in the act.
            "matches": matches_played,
            "wins": wins,
            "winrate": round(wins / matches_played * 100, 1) if matches_played else 0,
            # Matches actually included in the totals below. Use this, not
            # "matches", as the denominator for per-match averages.
            "matches_tracked": totals["matches"],

            # Existing flat fields kept for script.js / older act files.
            "avg_acs": summary["acs"] or 0,
            "kd": summary["kd"] or 0,
            "kad": summary["kad"] or 0,
            "kast": summary["kast"] or 0,
            "dd_delta": summary["dd_delta"] or 0,
            "acs_total": totals["score"],
            "rounds_total": totals["rounds"],
            "kills_total": totals["kills"],
            "deaths_total": totals["deaths"],
            "assists_total": totals["assists"],
            "kast_rounds_total": totals["kast_rounds"],
            "damage_delta_total": totals["damage_dealt"] - totals["damage_received"],
            "time_total": totals["time_played_ms"],
            "headshots_total": totals["headshots"],
            "bodyshots_total": totals["bodyshots"],
            "legshots_total": totals["legshots"],
            "hs_percent": summary["hs_percent"] if shots else 0,
            "performance_score_total": round(totals["performance_score_total"], 3),
            "performance_score_matches": totals["performance_score_matches"],
            "avg_performance_score": summary["avg_performance_score"],
            "performance_breakdown_totals": totals["performance_breakdown_totals"],
            "performance_breakdown_averages": summary["performance_breakdown_averages"],
            "performance_grades": totals["performance_grades"],
            "performance_ratings": totals["performance_ratings"],
            "enemy_rank_sum": totals["enemy_rank_sum"],
            "enemy_rank_matches": totals["enemy_rank_matches"],
            "enemy_rank_average_value": summary["enemy_rank_average_value"],
            "lobby_rank_sum": totals["lobby_rank_sum"],
            "lobby_rank_matches": totals["lobby_rank_matches"],
            "lobby_rank_average_value": summary["lobby_rank_average_value"],
            "rank_delta_sum": round(totals["rank_delta_sum"], 3),
            "rank_delta_matches": totals["rank_delta_matches"],
            "rank_delta_average": summary["rank_delta_average"],

            # New: full derived stats for the act, per-agent stats and the raw
            # totals needed to keep adding matches incrementally.
            "summary": summary,
            "agents": agents_out,
            "totals": totals,

            "accolades_seasonal": accolades_seasonal,

            "party": {
                "by_size": dict(sorted(party_sizes.items())),
                "friends": dict(sorted(party_friends.items(), key=lambda item: -item[1]["me"]["matches"])),
            },
            "recent_matches": recent_matches,
            "match_log": match_log_out,
            "rr_history": rr_history,

            "processed_matches": sorted(processed_match_ids),
        })

    except Exception as error:
        print(f"Failed {riot}: {error}")
        if old and old.get("season") == CURRENT_ACT:
            out.append(old)

# meta.json: when the stats were last checked, and when they last changed,
# so the site can show an accurate "updated" time.
old_meta = load_json("meta.json", {}) or {}
stats_changed = json.dumps(out, sort_keys=True) != json.dumps(old_data, sort_keys=True)
write_json("stats.json", out)
write_json("meta.json", {
    "checked_at": RUN_TIME,
    "changed_at": RUN_TIME if stats_changed or not old_meta.get("changed_at") else old_meta["changed_at"],
    "act": CURRENT_ACT,
})

print("stats.json updated")