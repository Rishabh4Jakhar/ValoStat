import requests
import json
import os
import time

API_KEY = os.environ["HENRIK_API_KEY"]
HEADERS = {"Authorization": API_KEY}

REGION = "ap"
PLATFORM = "pc"
CURRENT_ACT = "e11a4" #V26A4

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
MIN_INTERVAL = 100 / 28  # ~2.15 seconds per request (safe)

# API Rate Limit

def rate_limited_get(url):
    global LAST_REQUEST_TIME

    now = time.time()
    wait = MIN_INTERVAL - (now - LAST_REQUEST_TIME)
    if wait > 0:
        time.sleep(wait)

    r = requests.get(url, headers=HEADERS)
    LAST_REQUEST_TIME = time.time()

    if r.status_code == 429:
        print("Rate limited. Sleeping 30s...")
        time.sleep(30)
        return rate_limited_get(url)

    r.raise_for_status()
    return r

# API Calls

def get_account(name, tag):
    url = f"https://api.henrikdev.xyz/valorant/v1/account/{name}/{tag}"
    return rate_limited_get(url).json()["data"]

def get_mmr(puuid):
    url = f"https://api.henrikdev.xyz/valorant/v3/by-puuid/mmr/{REGION}/{PLATFORM}/{puuid}"
    return rate_limited_get(url).json()["data"]

def get_matches(puuid):
    url = (
        f"https://api.henrikdev.xyz/valorant/v4/by-puuid/matches/"
        f"{REGION}/{PLATFORM}/{puuid}"
        "?mode=competitive&size=10"
    )
    return rate_limited_get(url).json()["data"]


def resolve_player_identity(pid, riot, old_data_map):
    old = old_data_map.get(pid, {})
    puuid = old.get("puuid")
    banner = old.get("banner")

    if puuid and banner:
        return puuid, banner, None

    name, tag = riot.split("#")
    acc = get_account(name, tag)
    return puuid or acc["puuid"], acc["card"]["small"], acc

# Load existing data

if os.path.exists("stats.json"):
    with open("stats.json") as f:
        old_data = json.load(f)
else:
    old_data = []

old_data_map = {d["id"]: d for d in old_data}

out = []

for pid, riot in PLAYERS.items():
    name, tag = riot.split("#")
    print(f"Fetching {riot}")

    try:
        puuid, banner, acc = resolve_player_identity(pid, riot, old_data_map)
        old = old_data_map.get(pid, {})
        stored_matches = old.get("matches", 0)


        mmr = get_mmr(puuid)


        season = next(
            (s for s in mmr["seasonal"] if s["season"]["short"] == CURRENT_ACT),
            None
        )

        if not season:
            print(f"No MMR data for current act for {riot}")
            continue

        # Only fetch match history when season data has moved ahead of what we already stored.
        if season["games"] > stored_matches:
            matches = get_matches(puuid)
        else:
            matches = []
            print(f"No new matches for {riot}, skipping match fetch")
        account_level = old.get("level", 0)
        processed_match_ids = set(old.get("processed_matches", []))

        acs_total=old.get("acs_total", 0)
        rounds_total=old.get("rounds_total", 0)
        kills_total=old.get("kills_total", 0)
        deaths_total=old.get("deaths_total", 0)
        assists_total=old.get("assists_total", 0)
        kast_rounds_total=old.get("kast_rounds_total", 0)
        damage_delta_total=old.get("damage_delta_total", 0)
        time_total=old.get("time_total", 0)
        wins_total=old.get("wins", 0)
        new_matches_count=0

        for m in matches:
            #print(m, "\n", "for ", riot)
            match_id = m["metadata"]["match_id"]
            act= m["metadata"].get("season", {}).get("short")
            if act != CURRENT_ACT or match_id in processed_match_ids:
                continue

            rounds = len(m["rounds"])
            if rounds == 0:
                continue

            player = next(p for p in m["players"] if p["puuid"] == puuid)
            stats = player["stats"]
            account_level = player["account_level"]
            player_team = player["team_id"]
            winning_team = next(team["team_id"] for team in m["teams"] if team["won"])
            if player_team == winning_team:
                wins_total += 1
            kills = stats["kills"]
            deaths = stats["deaths"]
            assists = stats["assists"]
            acs = stats["score"]

            kills_total += kills
            deaths_total += deaths
            assists_total += assists
            acs_total += acs
            rounds_total += rounds
            time_total += m["metadata"]["game_length_in_ms"]
            damage_delta_total += (
                stats["damage"]["dealt"] - stats["damage"]["received"]
            )

            kast_round_flags = set()
            death_rounds=set()

            for k in m["kills"]:
                if k["killer"]["puuid"] == puuid:
                    kast_round_flags.add(k["round"])
                if k["victim"]["puuid"] == puuid:
                    death_rounds.add(k["round"])
                for a in k.get("assistants", []):
                    if a["puuid"] == puuid:
                        kast_round_flags.add(k["round"])
            
            survived_rounds = set(range(1, rounds+1)) - death_rounds
            kast_round_flags.update(survived_rounds)
            kast_rounds_total += min(rounds, len(kast_round_flags))

            processed_match_ids.add(match_id)
            new_matches_count+=1

        #matches = filter_matches_by_act(matches, CURRENT_ACT)
        print(f"New matches for {riot}: {new_matches_count}")

        if len(matches)==0:
            print(f"No matches in current act for {riot}; preserving existing stats")
        #perf = compute_match_stats(matches, puuid)

        avg_acs=round(acs_total / rounds_total, 1) if rounds_total else 0
        kd = round(kills_total / max(deaths_total, 1), 2)
        kad = round((kills_total + assists_total) / max(deaths_total, 1), 2)
        kast = round((kast_rounds_total / rounds_total) * 100, 1) if rounds_total else 0
        dd_delta = round(damage_delta_total / rounds_total, 1) if rounds_total else 0

        matches_played = season["games"]
        #wins = season["wins"]
        # Testing manual wins counting
        wins = wins_total
        # TODO: API might be returning blank riot_id for some accounts, need to verify and handle that case
        # Currently just using the name and tag from the input mapping, which should be fine as long as they don't change their name/tag

        out.append({
            "id": pid,
            "riot_id": riot,
            "name": name,
            "level": account_level,
            "banner": banner,
            "puuid": puuid,
            "rank": mmr["current"]["tier"]["name"],
            "rr": mmr["current"]["rr"],
            "elo": mmr["current"]["elo"],  # API-provided
            "season": CURRENT_ACT,
            "matches": matches_played,
            "wins": wins,
            "winrate": round((wins / matches_played) * 100, 1),
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
            "processed_matches": sorted(list(processed_match_ids))
        })

    except Exception as e:
        print(f"Failed {riot}: {e}")
        # Still add old data if available, to avoid losing it
        if pid in old_data_map:
            out.append(old_data_map[pid])

with open("stats.json", "w") as f:
    json.dump(out, f, indent=2)

print("stats.json updated")
