import requests
import json
import os
import time

API_KEY = os.environ["HENRIK_API_KEY"]
HEADERS = {"Authorization": API_KEY}

REGION = "ap"
PLATFORM = "pc"
CURRENT_ACT = "e11a1"

PLAYERS = {
    "Rishabh": "Rishabh4#Gamer",
    "Akshat": "Flashgaming4#FAST",
    "Advik": "NøVä#8790",
    "Modit": "Limitless065#5079",
    "Moksh": "CuteBoyMox#9710",
    "Nityaa": "LadyWhistledown#2310",
    "Timmy": "timmyy#latte",
    "Dhimanth": "MicCheck123#hallo",
    "Ria": "Ria4#2222",
    "Ria_alt": "Ria4#4444",
    "Bodit": "Limited065#8643",
    "Siddharth": "BravosidOP#India",
    "Hardik": "Livein#1234",
    "Ritwik": "RITWIK#6493",
    "Sonu": "reducto#12432",
    "Tanmay": "KabruhSingh#Drunk",
    "Aryan": "TheChosenOne#2205",
    "Eklavya": "MadLiberator2005#9683",
    "Yash": "yashkali997#kali"
}
LAST_REQUEST_TIME = 0
MIN_INTERVAL = 200 / 28  # ~2.15 seconds per request (safe)

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

def filter_matches_by_act(matches, act):
    filtered = []
    for m in matches:
        season = m.get("metadata", {}).get("season", {})
        if season.get("short") == act:
            filtered.append(m)
    return filtered


def compute_match_stats(matches, puuid):
    acs_sum = 0
    kd_sum = 0
    kad_sum = 0
    total_rounds = 0
    kast_rounds = 0
    damage_delta = 0
    match_count = 0

    for m in matches:
        rounds = len(m["rounds"])
        if rounds == 0:
            continue

        match_count += 1
        total_rounds += rounds

        player = next(p for p in m["players"] if p["puuid"] == puuid)
        stats = player["stats"]

        kills = stats["kills"]
        deaths = max(stats["deaths"], 1)
        assists = stats["assists"]

        # ACS (per match)
        acs_sum += stats["score"] / rounds

        # KD / KA-D
        kd_sum += kills / deaths
        kad_sum += (kills + assists) / deaths

        # Damage delta
        damage_delta += (
            stats["damage"]["dealt"] - stats["damage"]["received"]
        )

        # ---- KAST (OR logic, round counted once) ----
        kast_round_flags = set()

        for k in m["kills"]:
            if k["killer"]["puuid"] == puuid:
                kast_round_flags.add(k["round"])
            for a in k.get("assistants", []):
                if a["puuid"] == puuid:
                    kast_round_flags.add(k["round"])

        survived_rounds = rounds - stats["deaths"]
        kast_rounds += min(rounds, len(kast_round_flags) + survived_rounds)

    return {
        "avg_acs_10": round(acs_sum / match_count, 1) if match_count else 0,
        "kd_10": round(kd_sum / match_count, 2) if match_count else 0,
        "kad_10": round(kad_sum / match_count, 2) if match_count else 0,
        "kast_10": round((kast_rounds / total_rounds) * 100, 1) if total_rounds else 0,
        "dd_delta_10": round(damage_delta / total_rounds, 1) if total_rounds else 0
    }

out = []

for pid, riot in PLAYERS.items():
    name, tag = riot.split("#")
    print(f"Fetching {riot}")

    try:
        acc = get_account(name, tag)
        puuid = acc["puuid"]
        banner = acc["card"]["small"]


        mmr = get_mmr(puuid)


        season = next(
            (s for s in mmr["seasonal"] if s["season"]["short"] == CURRENT_ACT),
            None
        )

        if not season:
            continue

        matches = get_matches(puuid)
        matches = filter_matches_by_act(matches, CURRENT_ACT)

        if len(matches)==0:
            print(f"No matches in current act for {riot}")
            continue
        perf = compute_match_stats(matches, puuid)


        matches_played = season["games"]
        wins = season["wins"]

        out.append({
            "id": pid,
            "riot_id": f"{acc['name']}#{acc['tag']}",
            "name": acc["name"],
            "banner": banner,
            "rank": mmr["current"]["tier"]["name"],
            "rr": mmr["current"]["rr"],
            "elo": mmr["current"]["elo"],  # API-provided
            "season": CURRENT_ACT,
            "matches": matches_played,
            "wins": wins,
            "winrate": round((wins / matches_played) * 100, 1),
            **perf
        })

    except Exception as e:
        print(f"❌ Failed {riot}: {e}")

with open("stats.json", "w") as f:
    json.dump(out, f, indent=2)

print("✅ stats.json updated")
