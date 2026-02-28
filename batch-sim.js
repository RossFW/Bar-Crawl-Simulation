#!/usr/bin/env node
// ============================================================
//  🍌 Headless Batch Simulator — Where's the Host?
//  Runs N simulations per bar, outputs stats + host bar tab calc
//  Usage: node batch-sim.js [numSims] [numGroups] [totalAttendees]
// ============================================================

'use strict';

// ---- Config from CLI args ----------------------------------
const NUM_SIMS = parseInt(process.argv[2]) || 500;
const NUM_GROUPS = parseInt(process.argv[3]) || 12;
const TOTAL_ATTENDEES = parseInt(process.argv[4]) || 30;
const MEAN_DWELL = 30;
const SKIP_PROB = 0.15;
const RECOG_PROB = 0.75;
const MAX_SIM_MINUTES = 300;
const PROXIMITY_DEG = 0.0006;

// ---- Bar Data ----------------------------------------------
const BARS = [
  { id: 0, name: 'Victory Sandwich Bar',        travelToNext: 7  },
  { id: 1, name: 'Painted Park',                travelToNext: 8  },
  { id: 2, name: 'Ladybird Grove & Mess Hall',  travelToNext: 7  },
  { id: 3, name: 'Brewdog Atlanta',             travelToNext: 2  },
  { id: 4, name: 'Pour Taproom-Beltline',       travelToNext: 1  },
  { id: 5, name: 'Guac y Margys',               travelToNext: 2  },
  { id: 6, name: "McCray's Tavern", travelToNext: 0  },
];

const TRAVEL_TIME = Array(7).fill(null).map(() => Array(7).fill(0));
for (let i = 0; i < 7; i++) {
  for (let j = i + 1; j < 7; j++) {
    TRAVEL_TIME[i][j] = BARS.slice(i, j).reduce((s, b) => s + b.travelToNext, 0);
    TRAVEL_TIME[j][i] = TRAVEL_TIME[i][j];
  }
}

// ---- Utilities ---------------------------------------------
function gaussianSample(mean, sd) {
  let u;
  do { u = Math.random(); } while (u === 0);
  const v = Math.random();
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function formatTime(m) {
  const totalMin = Math.round(m);
  let hour = 15 + Math.floor(totalMin / 60);
  const min = totalMin % 60;
  const ampm = hour >= 24 ? 'AM' : (hour >= 12 ? 'PM' : 'AM');
  hour = hour % 24;
  const h12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

// ---- Headless Simulation -----------------------------------
function assignGroupSizes(totalAttendees, numGroups) {
  const effective = Math.max(totalAttendees, numGroups);
  const base = Math.floor(effective / numGroups);
  const rem = effective % numGroups;
  return Array(numGroups).fill(base).map((s, i) => s + (i < rem ? 1 : 0));
}

function checkDeduction(g, hostBarIndex) {
  if (g.knowsHostBar || g.phase === 'found') return;
  if (g.knownClearBars.size >= BARS.length - 1) {
    for (let i = 0; i < BARS.length; i++) {
      if (!g.knownClearBars.has(i)) {
        g.deducedHostBar = i;
        g.knowsHostBar = true;
        return;
      }
    }
  }
}

function chooseNextBar(g) {
  const cur = g.currentBarIndex;
  const allBars = Array.from({ length: BARS.length }, (_, i) => i);
  const unclearedBars = allBars.filter(i => i !== cur && !g.knownClearBars.has(i));
  if (unclearedBars.length === 0) return null;

  if (Math.random() < SKIP_PROB) {
    return pickRandom(unclearedBars);
  }

  const adjacent = [];
  if (cur > 0 && !g.knownClearBars.has(cur - 1)) adjacent.push(cur - 1);
  if (cur < BARS.length - 1 && !g.knownClearBars.has(cur + 1)) adjacent.push(cur + 1);

  if (adjacent.length > 0) return pickRandom(adjacent);

  unclearedBars.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
  return unclearedBars[0];
}

function shareKnowledge(a, b, hostBarIndex) {
  if (a.phase === 'found' || a.knowsHostBar) {
    if (!b.knowsHostBar && b.phase !== 'found') {
      b.knowsHostBar = true;
      b.deducedHostBar = hostBarIndex;
    }
  }
  if (b.phase === 'found' || b.knowsHostBar) {
    if (!a.knowsHostBar && a.phase !== 'found') {
      a.knowsHostBar = true;
      a.deducedHostBar = hostBarIndex;
    }
  }
  const unionClear = new Set([...a.knownClearBars, ...b.knownClearBars]);
  a.knownClearBars = new Set(unionClear);
  b.knownClearBars = new Set(unionClear);
  checkDeduction(a, hostBarIndex);
  checkDeduction(b, hostBarIndex);
}

function runOneSim(hostBarIndex) {
  const sizes = assignGroupSizes(TOTAL_ATTENDEES, NUM_GROUPS);

  const groups = sizes.map((size, id) => ({
    id,
    size,
    arrivalMinute: clamp(gaussianSample(5, 8), 0, 30),
    phase: 'waiting',
    currentBarIndex: Math.floor(Math.random() * BARS.length),
    departureBarIndex: 0,
    nextBarIndex: null,
    dwellUntil: 0,
    arriveAt: null,
    travelStartMinute: null,
    knowsHostBar: false,
    deducedHostBar: null,
    foundAtMinute: null,
    knownClearBars: new Set(),
  }));

  // Set initial dwell
  for (const g of groups) {
    g.departureBarIndex = g.currentBarIndex;
    g.dwellUntil = g.arrivalMinute + clamp(gaussianSample(MEAN_DWELL, 8), 15, 60);
  }

  const discoveryTimes = [];
  let simMinute = 0;
  const DT = 0.5; // time step in sim-minutes

  while (simMinute < MAX_SIM_MINUTES) {
    simMinute += DT;

    // Update each group
    for (const g of groups) {
      if (g.phase === 'found') continue;

      if (g.phase === 'waiting') {
        if (simMinute >= g.arrivalMinute) {
          g.phase = 'dwelling';
          if (g.currentBarIndex !== hostBarIndex) {
            g.knownClearBars.add(g.currentBarIndex);
            checkDeduction(g, hostBarIndex);
          }
          if (g.currentBarIndex === hostBarIndex) {
            g.phase = 'found';
            g.foundAtMinute = simMinute;
            discoveryTimes.push(simMinute);
          }
        }
        continue;
      }

      if (g.phase === 'dwelling') {
        if (g.currentBarIndex === hostBarIndex) {
          g.phase = 'found';
          g.foundAtMinute = simMinute;
          discoveryTimes.push(simMinute);
          continue;
        }
        if (simMinute >= g.dwellUntil) {
          // Depart
          let nextBar;
          if (g.knowsHostBar) {
            nextBar = g.deducedHostBar !== null ? g.deducedHostBar : hostBarIndex;
            if (nextBar === g.currentBarIndex) {
              g.phase = 'found';
              g.foundAtMinute = simMinute;
              discoveryTimes.push(simMinute);
              continue;
            }
          } else {
            nextBar = chooseNextBar(g);
            if (nextBar === null) {
              g.dwellUntil = simMinute + clamp(gaussianSample(MEAN_DWELL, 8), 15, 60);
              continue;
            }
          }
          g.departureBarIndex = g.currentBarIndex;
          g.nextBarIndex = nextBar;
          g.travelStartMinute = simMinute;
          g.arriveAt = simMinute + TRAVEL_TIME[g.currentBarIndex][nextBar];
          g.phase = 'traveling';
        }
        continue;
      }

      if (g.phase === 'traveling') {
        if (g.knowsHostBar && g.nextBarIndex !== (g.deducedHostBar !== null ? g.deducedHostBar : hostBarIndex)) {
          const target = g.deducedHostBar !== null ? g.deducedHostBar : hostBarIndex;
          g.departureBarIndex = g.currentBarIndex;
          g.nextBarIndex = target;
          g.travelStartMinute = simMinute;
          g.arriveAt = simMinute + TRAVEL_TIME[g.currentBarIndex][target];
        }
        if (simMinute >= g.arriveAt) {
          g.currentBarIndex = g.nextBarIndex;
          g.nextBarIndex = null;
          g.phase = 'dwelling';
          g.dwellUntil = simMinute + clamp(gaussianSample(MEAN_DWELL, 8), 15, 60);
          if (g.currentBarIndex !== hostBarIndex) {
            g.knownClearBars.add(g.currentBarIndex);
            checkDeduction(g, hostBarIndex);
          }
          if (g.currentBarIndex === hostBarIndex) {
            g.phase = 'found';
            g.foundAtMinute = simMinute;
            discoveryTimes.push(simMinute);
          }
        }
      }
    }

    // Bar sharing
    const atBar = {};
    for (const g of groups) {
      if (g.phase === 'dwelling' || g.phase === 'found') {
        const b = g.currentBarIndex;
        if (!atBar[b]) atBar[b] = [];
        atBar[b].push(g);
      }
    }
    for (const b in atBar) {
      const here = atBar[b];
      if (here.length < 2) continue;
      for (let i = 0; i < here.length; i++) {
        for (let j = i + 1; j < here.length; j++) {
          if (Math.random() < RECOG_PROB) {
            shareKnowledge(here[i], here[j], hostBarIndex);
          }
        }
      }
    }

    // Check termination
    if (groups.every(g => g.phase === 'found')) break;
  }

  const allFound = groups.every(g => g.phase === 'found');
  const lastFoundTime = discoveryTimes.length > 0 ? Math.max(...discoveryTimes) : MAX_SIM_MINUTES;

  // ---- Host Bar Tab Calculation ----------------------------
  // $250 pot, drinks cost $15, 20% tip ($18 effective per drink)
  // 1 drink per 40 min per person, cap 6 drinks per person
  const DRINK_COST = 15;
  const TIP_RATE = 0.20;
  const COST_PER_DRINK = DRINK_COST * (1 + TIP_RATE); // $18
  const POT = 250;
  const DRINK_INTERVAL = 40; // minutes per drink
  const MAX_DRINKS_PP = 6;

  let totalDrinksAtHost = 0;
  for (const g of groups) {
    if (g.foundAtMinute !== null) {
      const timeAtHost = simMinute - g.foundAtMinute;
      const drinksPerPerson = Math.min(Math.floor(timeAtHost / DRINK_INTERVAL) + 1, MAX_DRINKS_PP);
      totalDrinksAtHost += drinksPerPerson * g.size;
    }
  }
  const totalTabCost = totalDrinksAtHost * COST_PER_DRINK;
  const potRemaining = POT - totalTabCost;

  return {
    allFound,
    lastFoundTime,
    discoveryTimes,
    totalDrinksAtHost,
    totalTabCost,
    potRemaining,
    numFound: discoveryTimes.length,
    numGroups: groups.length,
  };
}

// ---- Stats Helpers -----------------------------------------
function mean(arr) {
  if (arr.length === 0) return 0;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stdDev(arr) {
  if (arr.length < 2) return 0;
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function median(arr) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function percentile(arr, p) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

// ---- Main --------------------------------------------------
console.log(`\n🍌 Where's the Host? — Batch Simulation`);
console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
console.log(`Config: ${NUM_SIMS} sims/bar, ${NUM_GROUPS} groups, ${TOTAL_ATTENDEES} attendees`);
console.log(`Dwell: ${MEAN_DWELL}min mean, Skip: ${SKIP_PROB * 100}%, Recognition: ${RECOG_PROB * 100}%`);
console.log(`Crawl starts: 3:00 PM, Max: ${MAX_SIM_MINUTES} min\n`);

const allResults = {};

for (let barIdx = 0; barIdx < BARS.length; barIdx++) {
  const results = [];
  for (let i = 0; i < NUM_SIMS; i++) {
    results.push(runOneSim(barIdx));
  }

  const lastFoundTimes = results.map(r => r.lastFoundTime);
  const completionRate = results.filter(r => r.allFound).length / NUM_SIMS * 100;
  const potRemainingArr = results.map(r => r.potRemaining);
  const totalDrinksArr = results.map(r => r.totalDrinksAtHost);

  allResults[barIdx] = {
    bar: BARS[barIdx].name,
    completionRate,
    meanLastFound: mean(lastFoundTimes),
    medianLastFound: median(lastFoundTimes),
    stdLastFound: stdDev(lastFoundTimes),
    p90LastFound: percentile(lastFoundTimes, 90),
    maxLastFound: Math.max(...lastFoundTimes),
    meanPotRemaining: mean(potRemainingArr),
    meanDrinksAtHost: mean(totalDrinksArr),
  };
}

// ---- Print Results -----------------------------------------
console.log(`${'Bar'.padEnd(35)} ${'Done%'.padStart(6)} ${'Mean'.padStart(10)} ${'Median'.padStart(10)} ${'StdDev'.padStart(10)} ${'P90'.padStart(10)} ${'Max'.padStart(10)}`);
console.log('─'.repeat(95));

for (let i = 0; i < BARS.length; i++) {
  const r = allResults[i];
  console.log(
    `${(i + 1 + '. ' + r.bar).padEnd(35)} ` +
    `${r.completionRate.toFixed(0).padStart(5)}% ` +
    `${formatTime(r.meanLastFound).padStart(10)} ` +
    `${formatTime(r.medianLastFound).padStart(10)} ` +
    `${r.stdLastFound.toFixed(1).padStart(9)}m ` +
    `${formatTime(r.p90LastFound).padStart(10)} ` +
    `${formatTime(r.maxLastFound).padStart(10)}`
  );
}

console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('💰 HOST BAR TAB ($250 pot, $15/drink + 20% tip)');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`${'Bar'.padEnd(35)} ${'Avg Drinks'.padStart(11)} ${'Avg Tab'.padStart(10)} ${'Pot Left'.padStart(10)}`);
console.log('─'.repeat(70));

for (let i = 0; i < BARS.length; i++) {
  const r = allResults[i];
  const avgTab = r.meanDrinksAtHost * 18;
  console.log(
    `${(i + 1 + '. ' + r.bar).padEnd(35)} ` +
    `${r.meanDrinksAtHost.toFixed(1).padStart(10)} ` +
    `$${avgTab.toFixed(0).padStart(8)} ` +
    `$${r.meanPotRemaining.toFixed(0).padStart(8)}`
  );
}

console.log('\nNote: "Last found" = time the LAST group finds the host (your worst case).');
console.log('Times are displayed as time of day (crawl starts 3:00 PM).\n');
