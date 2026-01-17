import requests
import json
import os
import time

API_KEY = os.environ["HENRIK_API_KEY"]
HEADERS = {"Authorization": API_KEY}

# 🔁 ADD / EDIT PLAYERS HERE
PLAYERS = {
    "Rishabh": "Rishabh4#Gamer",
    "Ria4 (Rishabh alt)": "Ria4#4444",
    "Ria4 (Alt 2)": "Ria4#2222",
}

REGION = "ap"  # asia pacific

def get_mmr(name, tag):
    url = f"https://api.henrikdev.xyz/valorant/v1/mmr/{REGION}/{name}/{tag}"
    r = requests.get(url, headers=HEADERS)
    r.raise_for_status()
    return r.json()["data"]

def get_lifetime(name, tag):
    url = f"https://api.henrikdev.xyz/valorant/v1/lifetime/mmr/{REGION}/{name}/{tag}"
    r = requests.get(url, headers=HEADERS)
    r.raise_for_status()
    return r.json()["data"]

out = []

for pid, riot in PLAYERS.items():
    name, tag = riot.split("#")
    print(f"Fetching {riot}")

    mmr = get_mmr(name, tag)
    life = get_lifetime(name, tag)

    out.append({
        "id": pid,
        "name": name,
        "rank": mmr["currenttierpatched"],
        "rr": mmr["ranking_in_tier"],
        "matches": life["totalgames"],
        "winrate": round((life["wins"] / life["totalgames"]) * 100, 1)
    })

    time.sleep(1.2)  # rate-limit safety

with open("stats.json", "w") as f:
    json.dump(out, f, indent=2)

print("stats.json updated")
