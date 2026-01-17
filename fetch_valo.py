import requests
import json
import os
import time

API_KEY = os.environ["HENRIK_API_KEY"]
HEADERS = {"Authorization": API_KEY}

REGION = "ap"
PLATFORM = "pc"

# 🔁 ADD PLAYERS HERE
PLAYERS = {
    "Rishabh": "Rishabh4#Gamer",
    "Ria4 (Rishabh alt)": "Ria4#4444",
    "Ria4 (Alt 2)": "Ria4#2222",
}

def get_account(name, tag):
    url = f"https://api.henrikdev.xyz/valorant/v1/account/{name}/{tag}"
    r = requests.get(url, headers=HEADERS)
    r.raise_for_status()
    return r.json()["data"]

def get_mmr_by_puuid(puuid):
    url = f"https://api.henrikdev.xyz/valorant/v3/by-puuid/mmr/{REGION}/{PLATFORM}/{puuid}"
    r = requests.get(url, headers=HEADERS)

    if r.status_code != 200:
        return None

    return r.json()["data"]

out = []

for pid, riot in PLAYERS.items():
    name, tag = riot.split("#")
    print(f"Fetching {riot}")

    try:
        account = get_account(name, tag)
        puuid = account["puuid"]

        mmr = get_mmr_by_puuid(puuid)

        if not mmr or not mmr.get("current_data"):
            print(f"⚠️ No ranked data for {riot}")
            continue

        current = mmr["current_data"]

        out.append({
            "id": pid,
            "name": name,
            "rank": current["currenttierpatched"],
            "rr": current["ranking_in_tier"],
            "matches": current["matches"],
            "winrate": round(
                (current["wins"] / current["matches"]) * 100, 1
            ) if current["matches"] > 0 else 0
        })

    except Exception as e:
        print(f"❌ Failed for {riot}: {e}")

    time.sleep(1.2)  # rate-limit safety

with open("stats.json", "w") as f:
    json.dump(out, f, indent=2)

print("✅ stats.json updated successfully")
