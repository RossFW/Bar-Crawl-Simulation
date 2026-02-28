# Model Assumptions — Where's the Host? 🍌

Agent-based model (ABM) simulating a bar crawl scavenger hunt along Atlanta's Beltline from Inman Park to Old Fourth Ward.

## The Setup

- **7 bars** along a 1.2-mile route, connected by fixed walking times (Google Maps estimates)
- **One host** hides at a single bar for the entire simulation
- **Groups of friends** move between bars trying to find the host
- Groups can share intel when they meet — if they recognize each other

## Route & Walking Times

| # | Bar | Walk to Next |
|---|-----|-------------|
| 1 | Victory Sandwich Bar | 7 min |
| 2 | Painted Park | 8 min |
| 3 | Ladybird Grove & Mess Hall | 7 min |
| 4 | Brewdog Atlanta | 2 min |
| 5 | Pour Taproom-Beltline | 1 min |
| 6 | Guac y Margys | 2 min |
| 7 | McCray's Tavern | — |

**Total walking time end-to-end: 27 minutes**

## Group Behavior

### Starting Positions
- Each group starts at a **uniformly random** bar (equal probability across all 7)
- Groups have a small staggered arrival delay: Normal(mean=5, sd=8) minutes, clamped to [0, 30]
- During the arrival delay, the group is in a "waiting" phase and cannot move or share info

### Group Sizes
- Total attendees are divided across groups as evenly as possible
- Default: 30 attendees across 12 groups (~2.5 people per group)
- Both values are adjustable via sliders

### Drinking / Dwelling
- At each bar, a group stays for a random duration: **Normal(mean, sd=8) minutes**, clamped to [15, 60]
- The mean dwell time is configurable (default: 30 minutes)
- Groups always finish their drink before leaving, even if they learn the host location while drinking

### Movement (No Tip)
Groups that don't know where the host is use **adjacent-bar navigation**:

1. Look at the two adjacent bars (one lower, one higher on the route)
2. Filter out bars they already **know are clear** (visited or learned through sharing)
3. If one or both adjacent bars are uncleared, **randomly pick** between them (50/50)
4. If both adjacent bars are cleared, go to the **nearest uncleared bar** on the route
5. **15% skip chance**: instead of going adjacent, uniformly pick any uncleared bar on the route

This means groups naturally explore nearby bars first, but occasionally make bigger jumps.

### Movement (With Tip / Deduction)
- Once a group knows where the host is (via direct tip or process of elimination), they **walk directly** to the host bar after finishing their current drink
- If they learn the host location while walking, they **redirect immediately**
- Walking works in **both directions** — groups can backtrack
- Walking time is the cumulative time between bars along the route

### Finding the Host
- A group finds the host when they are **dwelling at the host's bar**
- If a group happens to start at the host's bar, they find the host as soon as their arrival delay ends

## Knowledge System

Each group tracks two types of knowledge:

### 1. Cleared Bars (`knownClearBars`)
- A set of bar indices where the group **knows the host is NOT**
- Updated when: visiting a bar (host isn't there), or receiving info from another group
- Used for navigation decisions (avoid revisiting cleared bars)

### 2. Host Location (`knowsHostBar`)
- A boolean flag indicating the group knows the **exact** host bar
- Set when: told directly by a group that found the host, or **deduced by elimination** (if 6 of 7 bars are cleared, the 7th must be it)

### Process of Elimination
When a group's `knownClearBars` reaches 6 bars, they automatically deduce the host is at the remaining bar and beeline there. This can happen through:
- Visiting bars themselves
- Combining knowledge with other groups they meet

## Information Sharing

Sharing requires **recognition** — two groups must recognize each other (gated by recognition probability).

### At Bars (Dwelling Together)
- When 2+ groups are dwelling at the same bar, each pair rolls a recognition check
- If they recognize each other, they share:
  - Their full `knownClearBars` sets (union of both)
  - If either knows the host location, the other learns it too
- This happens every simulation tick

### Passing on Walks (Proximity)
- Groups that are physically close to each other (within **~60 meters** / 0.0006°) share knowledge
- Same recognition check and same info exchange as at bars
- Models bumping into friends on the Beltline

### What Recognition Rate Means
- Probability that two groups recognize each other and share intel per tick
- At 100%: every encounter results in full info sharing
- At 0%: groups never share and must find the host entirely alone
- At 75% (default): most encounters result in sharing, but some groups pass without connecting

## Host

- The host stays at **one bar for the entire simulation** (stationary)
- By default, the host bar is **randomized each run**
- The user can override this and pick a specific bar
- The host's location is revealed in the sidebar once the simulation starts

## Termination

The simulation ends when either:
1. **All groups have found the host** → confetti celebration 🎉
2. **300 simulated minutes have elapsed** → time limit reached

## Configurable Parameters

| Parameter | Default | Range | Effect |
|-----------|---------|-------|--------|
| Total Attendees | 30 | 4–80 | More people = larger groups |
| Number of Groups | 12 | 2–25 | More groups = more sharing opportunities |
| Mean Drink Time | 30 min | 15–60 min | Longer = groups move slower |
| Skip-a-Bar Chance | 15% | 0–50% | Higher = more random exploration |
| Recognition Rate | 75% | 0–100% | Higher = info spreads faster |
| Animation Speed | 10× | 1–60× | Visualization speed only |

## Simplifications & Limitations

- **No group splitting/merging**: Groups stay together for the entire simulation
- **Fixed walking speeds**: All groups walk at the same pace; no running, Ubers, or scooters
- **Single route**: Groups follow the bar chain; no shortcuts or alternate paths
- **Instant recognition**: Info sharing is instantaneous (no conversation delay)
- **No fatigue or dropout**: Groups never leave the crawl early
- **Discrete bar stops**: Groups only stop at bars, not at random points on the route
- **Perfect memory**: Groups never forget which bars they've cleared
