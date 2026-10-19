# [ValoStat](https://rishabh4jakhar.github.io/ValoStat/)

Valorant stats for a group of friends: one card per player, a detailed profile for each, and a score that makes it easy to compare everyone.

## Features

- Player cards for the current act, each coloured by the player's rank tier
- Every past act, plus an Overall view that combines them
- Detailed player profile with five tabs: overview, performance, agents, matchmaking and accolades
- Per-agent stats, filterable by role and sortable by any stat: win rate, ACS, ADR, K/D, KAST, headshot %, first bloods, multi-kills, clutches, utility use and best map
- Map results, opening duels, trades, match grades and economy
- Shareable player pages (`player.html?id=<player>&act=<act code>`)
- Last 10 results on every card, and a recent-matches list in each profile
- Party stats: results by queue size (solo to 5-stack), and your stats next to each friend's in the matches you queued together
- RR over time with 1D, 1W, 1M and All ranges, coloured by rank tier, recorded at every update from V26: A6 onwards
- Show what changed since the last update, with each card noting the previous value
- Sort by any of 32 stats, highest or lowest first, with an optional minimum number of matches
- Shareable views: the act, sort and filters are kept in the page link
- Head-to-head comparison of two players across every stat, grouped by type, with a count of stats won
- Performance breakdown with the game's own impact ratings and match grade ranges
- Stats refresh automatically every 4 hours, and a new act is picked up and archived on its own

## ValoStat score

A single number from 10 to 1000 for one act.

**Acts with the API performance score (V26: A6 onwards)**

| Component | Weight |
| --- | --- |
| API performance score | 40% |
| ACS | 20% |
| KAST | 15% |
| KA/D | 10% |
| Damage delta per round | 10% |
| Win rate | 5% |

**Older acts without a performance score**

| Component | Weight |
| --- | --- |
| ACS | 30% |
| KAST | 20% |
| KA/D | 15% |
| Damage delta per round | 25% |
| Win rate | 10% |

Each stat is scaled to 0–1 before weighting (an S-curve for ACS, KA/D, damage delta and performance score; a straight percentage for KAST and win rate), so one extreme stat can't dominate the score.

The **Overall** score is the average of the player's score in each act they played, with every act counting equally. A player with no matches in an act gets no score for it, rather than a zero.

## How it works

```
GitHub Actions (every 4 hours)
  └─ fetch_valo.py ── HenrikDev API ──> stats.json        (current act)
                                       data/<act>.json   (finished acts)
                                       acts.json         (act list and labels)
GitHub Pages
  └─ index.html / player.html + script.js read those files
```

- `fetch_valo.py` only fetches matches it hasn't processed yet, stays under the API rate limit, and keeps running totals so rates like ACS and KAST are always computed from matching numerators and denominators.
- Agent playtime is the length of the matches played on that agent.
- KAST counts a round if the player got a kill or an assist, survived, or was traded within 5 seconds.

## Changing acts

Nothing to do by hand. When the MMR data shows a newer act, the fetch script:

1. copies `stats.json` to `data/<old act>.json`,
2. adds the new act to the top of `acts.json` and makes it current,
3. starts the new act's `stats.json` fresh.

The site builds its act buttons from `acts.json`. The script guesses the label (for example `V26: A7`, or `V27: A1` when the episode changes); edit `acts.json` to change it.

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

Data from the [HenrikDev Valorant API](https://api.henrikdev.xyz/dashboard). Not affiliated with Riot Games.
