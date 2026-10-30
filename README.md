# [ValoStat](https://rishabh4jakhar.github.io/ValoStat/)

Valorant stats for a group of friends: one card per player, a detailed profile for each, and a score that makes it easy to compare everyone. Stats refresh every 4 hours.

## Contents

- [ValoStat](#valostat)
  - [Contents](#contents)
  - [Features](#features)
    - [Main page](#main-page)
    - [Player profile](#player-profile)
  - [ValoStat score](#valostat-score)
  - [How the stats are worked out](#how-the-stats-are-worked-out)
  - [How it works](#how-it-works)
  - [New acts](#new-acts)
  - [Running it yourself](#running-it-yourself)
  - [Data files](#data-files)

## Features

### Main page

- Highlights for the last 24 hours, opened from a bar at the top: biggest RR climb, most matches, most kills, highest single-match ACS, best single match, best K/D, most MVPs, and best win rate with win streak, with the top three for each
- A card per player, coloured by rank tier and with the rank badge, with avg performance score, wins, win rate, K/D, KAST, playtime and the last 10 results
- The current act, every past act, and an Overall view that combines them
- Sort by any of 34 stats, highest or lowest first, with an optional minimum number of matches. RR change can be sorted over the last day, week, month or the whole act
- Show what changed since the last update, with each card noting the previous value
- Head-to-head comparison of two players across every stat, grouped by type, with a count of stats won
- Shareable views: the act, sort and filters are kept in the page link
- "This is me": mark your own player from their profile. Your card is labelled and listed first, and Compare starts with you. Saved in your browser only

### Player profile

Opens as a popup, or as its own page (`player.html?id=<player>&act=<act code>`). The header shows the player's wide in-game card art behind their name.

| Tab | What it shows |
| --- | --- |
| Overview | Headline stats, score in every act (coloured by the rank held), per-match averages and results by map |
| Performance | Opening duels, trades, multi-kills and clutches; the API's per-round breakdown with the game's own impact icons; match grades; utility and economy |
| Agents | Per-agent stats, filterable by role and sortable by 11 stats |
| Party | Results by queue size (solo to 5-stack), and your stats next to each friend's in the matches you queued together |
| Matchmaking | Average enemy and lobby rank, enemy rank compared with your own, RR over time (1D, 1W, 1M, All), and the last 10 matches grouped into play sessions (record, RR and average ACS per session) |
| Accolades | Season accolades with counts and best values |

## ValoStat score

A single number from 10 to 1000 for one act.

| Component | Acts with a performance score (V26: A6 onwards) | Older acts |
| --- | --- | --- |
| API performance score | 40% | — |
| ACS | 20% | 30% |
| KAST | 15% | 20% |
| KA/D | 10% | 15% |
| Damage delta per round | 10% | 25% |
| Win rate | 5% | 10% |

Each stat is scaled to 0–1 before weighting (an S-curve for ACS, KA/D, damage delta and performance score; a straight percentage for KAST and win rate), so one extreme stat can't dominate.

The **Overall** score is the average of the player's score in each act they played, with every act counting equally. An act with no matches is skipped rather than counted as zero.

## How the stats are worked out

- **Rates use matching totals.** ACS, ADR, KAST and damage delta are totals divided by rounds. Per-match averages divide by the matches actually fetched, which can be fewer than the season game count.
- **KAST** counts a round if the player got a kill or an assist, survived, or was traded within 5 seconds.
- **Agent playtime** is the length of the matches played on that agent.
- **Draws** are counted from fetched matches. The season data only gives games and wins, so in older acts a draw shows as a loss.
- **Average enemy and lobby rank** use the 1–25 scale from Iron 1 to Radiant, skipping unrated players.
- **Enemy rank vs own** is the average enemy rank minus your own rank, in divisions, per match. Your rank includes RR (Diamond 1 with 50 RR is 16.5). Enemy RR isn't in the match data, so enemies count as the middle of their division. +0.5 means enemies were half a division higher. Only matches fetched after this was added are counted.
- **RR over time** gets a point at each update where the rating changed. Several matches between updates show as one point, with the match count in the hover readout.
- **Party** groups players who queued together using the API's party ID.
- **Highlights** use the current act only. Single-match highlights (ACS, best match) use each player's best match. Only best win rate has a minimum, 2 matches.

## How it works

```
GitHub Actions (every 4 hours)
  └─ fetch_valo.py ── HenrikDev API ──> stats.json        (current act)
                                       data/<act>.json   (finished acts)
                                       acts.json         (act list and labels)
GitHub Pages
  └─ index.html / player.html + script.js read those files
```

- `fetch_valo.py` only fetches matches it hasn't processed yet, stops paging once it reaches an earlier act, and stays under the API rate limit.
- It keeps running totals, so each run only adds new matches.
- Agent roles and icons come from [valorant-api.com](https://valorant-api.com) when the page loads, with a built-in list as a fallback.

## New acts

Nothing to do by hand. Valorant has 6 acts a year; the site labels them by year (`V26: A6`), and the API by episode (`e11a6`). After act 6 comes act 1 of the next year, so `e11a6` is followed by `e12a1` (`V27: A1`).

Each run, the fetch script checks whether any tracked player has played the act right after the current one. When one has, it:

1. copies `stats.json` to `data/<old act>.json`,
2. adds the new act to the top of `acts.json` and makes it current,
3. starts the new act's `stats.json` fresh.

Only the next act in sequence triggers this, so a stray or older act code is ignored. The label is worked out automatically; edit `acts.json` to change it.

## Running it yourself

1. Get an API key from the [HenrikDev dashboard](https://api.henrikdev.xyz/dashboard).
2. Add it as a repository secret named `HENRIK_API_KEY`.
3. Edit the `PLAYERS` list in `fetch_valo.py` (`"Display name": "RiotName#TAG"`).
4. Run the "Update Valorant Stats" workflow, or locally:

   ```bash
   pip install -r requirements.txt
   HENRIK_API_KEY=your-key python fetch_valo.py
   python -m http.server
   ```

To rebuild every player's stats for the current act from scratch, raise `STATS_SCHEMA_VERSION` in `fetch_valo.py`. The next run then re-fetches the whole act (RR history is kept).

## Data files

| File | Contents |
| --- | --- |
| `stats.json` | Current act: one entry per player with totals, derived stats, agents, party stats, recent matches, RR history and a log of the last 2 days of matches |
| `stats_prev.json` | The previous run's `stats.json`, used for "Show changes since last update" |
| `data/<act>.json` | Finished acts. Acts before V26: A6 only have the basic stats |
| `acts.json` | The current act and the list of acts shown on the site |
| `meta.json` | When the stats were last checked and last changed, for the "updated" time at the top of the page |

Data from the [HenrikDev Valorant API](https://api.henrikdev.xyz/dashboard). Not affiliated with Riot Games.