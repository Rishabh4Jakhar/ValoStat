import requests
import json
import os
import time

API_KEY = os.environ["HENRIK_API_KEY"]
HEADERS = {"Authorization": API_KEY}

REGION = "ap"
PLATFORM = "pc"
CURRENT_ACT = "e11a6"  # V26A6

# Bump this when the shape of the stored totals changes. A player entry saved
# with an older version is rebuilt from scratch on the next run (its processed
# match list is discarded, so every match in the act is fetched again).
STATS_SCHEMA_VERSION = 2

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
)

MAP_COUNTER_KEYS = ("matches", "wins", "losses", "draws", "rounds", "rounds_won")


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

    while len(collected) < expected_new_matches:
        page = get_matches(puuid, start=start, size=page_size)
        if not page:
            break

        for match in page:
            metadata = match.get("metadata", {})
            match_id = metadata.get("match_id")
            act = (metadata.get("season") or {}).get("short")
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

    return {
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


# --------------------------------------------------------------------- main

if os.path.exists("stats.json"):
    with open("stats.json", encoding="utf-8") as file:
        old_data = json.load(file)
else:
    old_data = []

old_data_map = {item["id"]: item for item in old_data if isinstance(item, dict) and "id" in item}
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
        puuid, banner, account = resolve_player_identity(pid, riot, old_data_map)
        mmr = get_mmr(puuid)
        season = next(
            (item for item in mmr.get("seasonal", []) if item.get("season", {}).get("short") == CURRENT_ACT),
            None,
        )

        if not season:
            print(f"No MMR data for current act for {riot}; skipping")
            continue

        matches_played = season.get("games", 0) or 0
        wins = season.get("wins", 0) or 0

        processed_match_ids = set(old.get("processed_matches", [])) if up_to_date else set()
        totals = normalize_totals(old.get("totals")) if up_to_date else empty_totals()
        agent_totals = {
            agent_name: normalize_totals(agent.get("totals"))
            for agent_name, agent in (old.get("agents") or {}).items()
        } if up_to_date else {}

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

            add_match(totals, match_stats)
            add_match(agent_totals.setdefault(match_stats["agent"], empty_totals()), match_stats)

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

        current_tier = mmr.get("current") or {}

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
            "rank": (current_tier.get("tier") or {}).get("name", old.get("rank", "Unrated")),
            "rr": current_tier.get("rr", old.get("rr", 0)),
            "elo": current_tier.get("elo", old.get("elo", 0)),
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

            # New: full derived stats for the act, per-agent stats and the raw
            # totals needed to keep adding matches incrementally.
            "summary": summary,
            "agents": agents_out,
            "totals": totals,

            "accolades_seasonal": accolades_seasonal,
            "processed_matches": sorted(processed_match_ids),
        })

    except Exception as error:
        print(f"Failed {riot}: {error}")
        if old:
            out.append(old)

with open("stats.json", "w", encoding="utf-8") as file:
    json.dump(out, file, indent=2, ensure_ascii=False)

print("stats.json updated")