import requests
import json
import os
import time
from collections import defaultdict, Counter

API_KEY = os.environ["HENRIK_API_KEY"]
HEADERS = {"Authorization": API_KEY}

REGION = "ap"
PLATFORM = "pc"
CURRENT_ACT = "e11a6"  # V26A6

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


# API calls

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


def empty_agent_totals():
    return {
        "matches": 0,
        "time_played_ms": 0,
        "kills": 0,
        "deaths": 0,
        "assists": 0,
        "headshots": 0,
        "bodyshots": 0,
        "legshots": 0,
        "damage_dealt": 0,
        "damage_received": 0,
        "performance_score_total": 0.0,
        "performance_score_matches": 0,
        "performance_breakdown_totals": {key: 0.0 for key in PERFORMANCE_BREAKDOWN_KEYS},
        "performance_grades": {},
        "performance_ratings": {"combat": {}, "utility": {}},
    }


def merge_counter_dict(target, source):
    for key, value in (source or {}).items():
        target[key] = target.get(key, 0) + value


def normalize_agent_totals(existing):
    result = empty_agent_totals()
    if not isinstance(existing, dict):
        return result
    for key in (
        "matches", "time_played_ms", "kills", "deaths", "assists", "headshots",
        "bodyshots", "legshots", "damage_dealt", "damage_received",
        "performance_score_total", "performance_score_matches",
    ):
        if key in existing:
            result[key] = existing[key]
    for key in PERFORMANCE_BREAKDOWN_KEYS:
        result["performance_breakdown_totals"][key] = existing.get("performance_breakdown_totals", {}).get(key, 0.0)
        # result["performance_breakdown_counts"][key] = existing.get("performance_breakdown_counts", {}).get(key, 0)
    result["performance_grades"] = dict(existing.get("performance_grades", {}))
    for group in ("combat", "utility"):
        result["performance_ratings"][group] = dict(existing.get("performance_ratings", {}).get(group, {}))
    return result


def add_performance(performance, target):
    if not isinstance(performance, dict):
        return

    score = performance.get("score")
    if isinstance(score, (int, float)):
        target["performance_score_total"] += score
        target["performance_score_matches"] += 1

    breakdown = performance.get("breakdown") or {}
    for key in PERFORMANCE_BREAKDOWN_KEYS:
        value = breakdown.get(key)
        # Null means the metric wasn't applicable/available, not zero.
        if isinstance(value, (int, float)):
            target["performance_breakdown_totals"][key] += value
            # target["performance_breakdown_counts"][key] += 1

    ratings = performance.get("ratings") or {}
    grade = ratings.get("grade")
    if grade:
        target["performance_grades"][grade] = target["performance_grades"].get(grade, 0) + 1
    for group in ("combat", "utility"):
        for metric, rating in (ratings.get(group) or {}).items():
            if rating is not None:
                counts = target["performance_ratings"].setdefault(group, {}).setdefault(metric, {})
                counts[rating] = counts.get(rating, 0) + 1


def hs_percentage(headshots, bodyshots, legshots):
    total_shots = headshots + bodyshots + legshots
    return round(headshots / total_shots * 100, 1) if total_shots else 0


# Load current-act data. Existing fields are carried forward so this update
# remains compatible with the current script.js and any older stats.json.
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

    try:
        puuid, banner, account = resolve_player_identity(pid, riot, old_data_map)
        mmr = get_mmr(puuid)
        season = next(
            (item for item in mmr.get("seasonal", []) if item.get("season", {}).get("short") == CURRENT_ACT),
            None,
        )

        if not season:
            print(f"No MMR data for current act for {riot}; preserving old entry if available")
            #if old:
            #    out.append(old)
            continue

        #stored_matches = old.get("matches", 0)
        #if season.get("games", 0) > stored_matches:
        #    matches = get_matches(puuid)
        #else:
        #    matches = []
        #    print(f"No new matches for {riot}, skipping match fetch")
        matches_played = season.get("games", 0)
        processed_match_ids = set(old.get("processed_matches", []))
        expected_new_matches = max(0, int(matches_played or 0) - len(processed_match_ids))
        if expected_new_matches:
            matches = get_unprocessed_current_act_matches(
                puuid,
                CURRENT_ACT,
                processed_match_ids,
                expected_new_matches,
                page_size=10
            )
            print(
                f"Fetched {len(matches)} new matches for {riot} (expected {expected_new_matches})"
            )
        else:
            matches = []
            print(f"No new matches for {riot}, skipping match fetch")


        # Existing aggregate fields: keep them, and keep their meanings intact.
        acs_total = old.get("acs_total", 0)
        rounds_total = old.get("rounds_total", 0)
        kills_total = old.get("kills_total", 0)
        deaths_total = old.get("deaths_total", 0)
        assists_total = old.get("assists_total", 0)
        kast_rounds_total = old.get("kast_rounds_total", 0)
        damage_delta_total = old.get("damage_delta_total", 0)
        time_total = old.get("time_total", 0)

        # New act-level totals.
        headshots_total = old.get("headshots_total", 0)
        bodyshots_total = old.get("bodyshots_total", 0)
        legshots_total = old.get("legshots_total", 0)
        performance_score_total = old.get("performance_score_total", 0.0)
        performance_score_matches = old.get("performance_score_matches", 0)
        performance_breakdown_totals = dict(old.get("performance_breakdown_totals", {}))
        # performance_breakdown_counts = dict(old.get("performance_breakdown_counts", {}))
        for key in PERFORMANCE_BREAKDOWN_KEYS:
            performance_breakdown_totals.setdefault(key, 0.0)
            # performance_breakdown_counts.setdefault(key, 0)
        performance_grades = Counter(old.get("performance_grades", {}))
        performance_ratings = {
            "combat": {key: dict(value) for key, value in old.get("performance_ratings", {}).get("combat", {}).items()},
            "utility": {key: dict(value) for key, value in old.get("performance_ratings", {}).get("utility", {}).items()},
        }


        # Match-level rank averages use sums + counts so missing tiers aren't
        # treated as Iron 1 and future matches can be added correctly.
        enemy_rank_sum = old.get("enemy_rank_sum", 0.0)
        enemy_rank_matches = old.get("enemy_rank_matches", 0)
        lobby_rank_sum = old.get("lobby_rank_sum", 0.0)
        lobby_rank_matches = old.get("lobby_rank_matches", 0)

        agent_totals = {
            agent_name: normalize_agent_totals(agent_data)
            for agent_name, agent_data in old.get("agents", {}).items()
        }
        new_matches_count = 0
        latest_level = old.get("level", account.get("account_level", 0) if account else 0)
        latest_card_id = old.get("banner_card_id")

        for match in matches:
            metadata = match.get("metadata", {})
            match_id = metadata.get("match_id")
            act = metadata.get("season", {}).get("short")
            if not match_id or act != CURRENT_ACT or match_id in processed_match_ids:
                continue

            rounds = len(match.get("rounds", []))
            if rounds == 0:
                continue

            player = next((item for item in match.get("players", []) if item.get("puuid") == puuid), None)
            if not player:
                print(f"Could not find {riot} in match {match_id}; skipping this match")
                continue

            stats = player.get("stats", {})
            player_team = player.get("team_id")
            kills = stats.get("kills", 0) or 0
            deaths = stats.get("deaths", 0) or 0
            assists = stats.get("assists", 0) or 0
            # Preserve the existing ACS-like metric from stats.score for the existing frontend.
            score = stats.get("score", 0) or 0
            headshots = stats.get("headshots", 0) or 0
            bodyshots = stats.get("bodyshots", 0) or 0
            legshots = stats.get("legshots", 0) or 0
            damage = stats.get("damage", {}) or {}
            damage_dealt = damage.get("dealt", 0) or 0
            damage_received = damage.get("received", 0) or 0

            kills_total += kills
            deaths_total += deaths
            assists_total += assists
            acs_total += score
            rounds_total += rounds
            time_total += metadata.get("game_length_in_ms", 0) or 0
            damage_delta_total += damage_dealt - damage_received
            headshots_total += headshots
            bodyshots_total += bodyshots
            legshots_total += legshots

            kast_round_flags = set()
            death_rounds = set()
            for kill_event in match.get("kills", []):
                if (kill_event.get("killer") or {}).get("puuid") == puuid:
                    kast_round_flags.add(kill_event.get("round"))
                if (kill_event.get("victim") or {}).get("puuid") == puuid:
                    death_rounds.add(kill_event.get("round"))
                for assistant in kill_event.get("assistants", []) or []:
                    if assistant.get("puuid") == puuid:
                        kast_round_flags.add(kill_event.get("round"))
            kast_round_flags.update(set(range(1, rounds + 1)) - death_rounds)
            kast_rounds_total += min(rounds, len(kast_round_flags))

            performance = player.get("performance") or {}
            performance_score = performance.get("score")
            if isinstance(performance_score, (int, float)):
                performance_score_total += performance_score
                performance_score_matches += 1
            breakdown = performance.get("breakdown") or {}
            for key in PERFORMANCE_BREAKDOWN_KEYS:
                value = breakdown.get(key)
                if isinstance(value, (int, float)):
                    performance_breakdown_totals[key] += value
                    # performance_breakdown_counts[key] += 1
            ratings = performance.get("ratings") or {}
            if ratings.get("grade"):
                performance_grades[ratings["grade"]] += 1
            for group in ("combat", "utility"):
                for metric, rating in (ratings.get(group) or {}).items():
                    if rating is not None:
                        bucket = performance_ratings.setdefault(group, {}).setdefault(metric, {})
                        bucket[rating] = bucket.get(rating, 0) + 1

            agent_name = (player.get("agent") or {}).get("name") or "Unknown"
            agent = agent_totals.setdefault(agent_name, empty_agent_totals())
            agent["matches"] += 1
            agent["time_played_ms"] += player.get("session_playtime_in_ms", 0) or 0
            for key, value in {
                "kills": kills, "deaths": deaths, "assists": assists,
                "headshots": headshots, "bodyshots": bodyshots, "legshots": legshots,
                "damage_dealt": damage_dealt, "damage_received": damage_received,
            }.items():
                agent[key] += value
            add_performance(performance, agent)

            # Account level is present in match player data. customization.card is
            # a UUID, not a banner image URL, so retain the existing banner URL.
            if player.get("account_level") is not None:
                latest_level = player["account_level"]
            card_id = (player.get("customization") or {}).get("card")
            if card_id:
                latest_card_id = card_id


            # Enemy rank is the opposing team's average; lobby rank includes
            # every player with a known competitive tier.
            match_players = match.get("players", [])
            all_lobby_ranks = []
            enemy_ranks = []

            for lobby_player in match_players:
                tier_name = (lobby_player.get("tier") or {}).get("name")
                tier_value = RANK_VALUES.get(tier_name)

                if tier_value is None:
                    continue

                all_lobby_ranks.append(tier_value)

                if lobby_player.get("team_id") != player_team:
                    enemy_ranks.append(tier_value)

            if enemy_ranks:
                enemy_rank_sum += sum(enemy_ranks) / len(enemy_ranks)
                enemy_rank_matches += 1

            if all_lobby_ranks:
                lobby_rank_sum += sum(all_lobby_ranks) / len(all_lobby_ranks)
                lobby_rank_matches += 1



            processed_match_ids.add(match_id)
            new_matches_count += 1

        #print(f"New matches for {riot}: {new_matches_count}")
        if new_matches_count > 0:
            try:
                accolades_data = get_accolades(puuid)
                # Store the complete seasonal summary exactly as returned by the API.
                #accolades_seasonal = (accolades_data.get("summary") or {}).get("seasons", [])
                # accolades_data.get("seasons") is a list of dicts, each with a "season" key and a "accolades" key. We want the accolades for the current season, i.e., that is season["short"] = e11a6.
                accolades_seasonal = []
                for season_a in accolades_data.get("summary", {}).get("seasons", []): # data.get summary[seasons]
                    #print(season_a)
                    if season_a.get("season", {}).get("short") == CURRENT_ACT:
                        #print(season)
                        accolades_seasonal = season_a.get("accolades", [])
                        break      
                #print(accolades_seasonal)
            except Exception as accolades_error:
                print(f"Could not fetch accolades for {riot}: {accolades_error}")
                accolades_seasonal = old.get("accolades_seasonal", [])
        else:
            accolades_seasonal = old.get("accolades_seasonal", [])

        avg_acs = round(acs_total / rounds_total, 1) if rounds_total else 0
        kd = round(kills_total / max(deaths_total, 1), 2)
        kad = round((kills_total + assists_total) / max(deaths_total, 1), 2)
        kast = round(kast_rounds_total / rounds_total * 100, 1) if rounds_total else 0
        dd_delta = round(damage_delta_total / rounds_total, 1) if rounds_total else 0
        hs_percent = hs_percentage(headshots_total, bodyshots_total, legshots_total)

        agents_out = {}
        for agent_name, agent in agent_totals.items():
            shots = agent["headshots"] + agent["bodyshots"] + agent["legshots"]
            agent_copy = dict(agent)
            agent_copy["headshot_percentage"] = hs_percentage(agent["headshots"], agent["bodyshots"], agent["legshots"])
            agent_copy["average_performance_score"] = round(
                agent["performance_score_total"] / agent["performance_score_matches"], 2
            ) if agent["performance_score_matches"] else None
            agent_copy["performance_breakdown_averages"] = {
                # Calculate the average performance breakdown for each key.
                key: round(agent["performance_breakdown_totals"][key] / agent["performance_score_matches"], 3)
                if agent["performance_score_matches"] else None
                for key in PERFORMANCE_BREAKDOWN_KEYS
            }
            agents_out[agent_name] = agent_copy

        performance_breakdown_averages = {
            # Calculate the average performance breakdown for each key.
            key: round(performance_breakdown_totals[key] / performance_score_matches, 3)
            if performance_score_matches else None
            for key in PERFORMANCE_BREAKDOWN_KEYS
        }

        #matches_played = season.get("games", 0)
        wins = season.get("wins", 0)

        # MMR/season data is the source of truth for account-level competitive stats.
        # Match data refreshes level and provides the banner card UUID when available.
        out.append({
            # Existing fields retained for script.js compatibility.
            "id": pid,
            "riot_id": riot,
            "name": name,
            "level": latest_level,
            "banner": f"https://media.valorant-api.com/playercards/{latest_card_id}/displayicon.png" if latest_card_id else banner,
            "banner_card_id": latest_card_id,
            "puuid": puuid,
            "rank": (mmr.get("current") or {}).get("tier", {}).get("name", old.get("rank", "Unrated")),
            "rr": (mmr.get("current") or {}).get("rr", old.get("rr", 0)),
            "elo": (mmr.get("current") or {}).get("elo", old.get("elo", 0)),
            "season": CURRENT_ACT,
            "matches": matches_played,
            "wins": wins,
            "winrate": round(wins / matches_played * 100, 1) if matches_played else 0,
            "avg_acs": avg_acs,
            "kd": kd,
            "kad": kad,
            "kast": kast,
            "dd_delta": dd_delta,
            "acs_total": acs_total,
            "rounds_total": rounds_total,
            "kills_total": kills_total,
            "deaths_total": deaths_total,
            "assists_total": assists_total,
            "kast_rounds_total": kast_rounds_total,
            "damage_delta_total": damage_delta_total,
            "time_total": time_total,
            "processed_matches": sorted(processed_match_ids),

            # New match-level aggregate stats.
            "headshots_total": headshots_total,
            "bodyshots_total": bodyshots_total,
            "legshots_total": legshots_total,
            "hs_percent": hs_percent,
            "performance_score_total": round(performance_score_total, 3),
            "performance_score_matches": performance_score_matches,
            "avg_performance_score": round(performance_score_total / performance_score_matches, 2)
                if performance_score_matches else None,
            "enemy_rank_average_value": (
                round(enemy_rank_sum / enemy_rank_matches, 2)
                if enemy_rank_matches else None
            ),
            "enemy_rank_matches": enemy_rank_matches,
            "lobby_rank_average_value": (
                round(lobby_rank_sum / lobby_rank_matches, 2)
                if lobby_rank_matches else None
            ),
            "lobby_rank_matches": lobby_rank_matches,
            "enemy_rank_sum": enemy_rank_sum,
            "lobby_rank_sum": lobby_rank_sum,                
            "performance_breakdown_totals": performance_breakdown_totals,
            #"performance_breakdown_counts": performance_breakdown_counts,
            "performance_breakdown_averages": performance_breakdown_averages,
            "performance_grades": dict(performance_grades),
            "performance_ratings": performance_ratings,
            "agents": agents_out,
            "accolades_seasonal": accolades_seasonal,
        })

    except Exception as error:
        print(f"Failed {riot}: {error}")
        if old:
            out.append(old)

with open("stats.json", "w", encoding="utf-8") as file:
    json.dump(out, file, indent=2, ensure_ascii=False)

print("stats.json updated")
