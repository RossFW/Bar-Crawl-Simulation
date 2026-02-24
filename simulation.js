// ============================================================
//  🍌 Where's the Host? — Banana Beltline Bar Crawl ABM
//  Atlanta · Inman Park → Old Fourth Ward · 7 bars
// ============================================================

'use strict';

// ---- Bar Data ----------------------------------------------
const BARS = [
  { id: 0, name: 'Victory Sandwich Bar',        lat: 33.7755, lng: -84.3401, travelToNext: 7  },
  { id: 1, name: 'Painted Park',                lat: 33.7715, lng: -84.3478, travelToNext: 8  },
  { id: 2, name: 'Ladybird Grove & Mess Hall',  lat: 33.7643, lng: -84.3568, travelToNext: 7  },
  { id: 3, name: 'Brewdog Atlanta',             lat: 33.7519, lng: -84.3639, travelToNext: 2  },
  { id: 4, name: 'Pour Taproom-Beltline',       lat: 33.7498, lng: -84.3647, travelToNext: 1  },
  { id: 5, name: 'Guac y Margys',               lat: 33.7492, lng: -84.3650, travelToNext: 2  },
  { id: 6, name: "Duke's Hideaway at McCray's", lat: 33.7462, lng: -84.3658, travelToNext: 0  },
];

// Precompute cumulative walking time between any two bars (both directions)
const TRAVEL_TIME = Array(7).fill(null).map(() => Array(7).fill(0));
for (let i = 0; i < 7; i++) {
  for (let j = i + 1; j < 7; j++) {
    TRAVEL_TIME[i][j] = BARS.slice(i, j).reduce((s, b) => s + b.travelToNext, 0);
    TRAVEL_TIME[j][i] = TRAVEL_TIME[i][j];
  }
}

// Proximity threshold in degrees (~60m) for detecting groups passing each other
const PROXIMITY_DEG = 0.0006;

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

function formatMin(m) {
  if (m === null || m === undefined || isNaN(m)) return '—';
  const t = Math.round(m);
  if (t < 60) return `${t} min`;
  return `${Math.floor(t / 60)}h ${t % 60}m`;
}

// Format sim minutes as real time of day (crawl starts at 3:00 PM)
function formatTime(m) {
  if (m === null || m === undefined || isNaN(m)) return '—';
  const totalMin = Math.round(m);
  let hour = 15 + Math.floor(totalMin / 60); // 15 = 3 PM
  const min = totalMin % 60;
  const ampm = hour >= 24 ? 'AM' : (hour >= 12 ? 'PM' : 'AM');
  hour = hour % 24;
  const h12 = hour > 12 ? hour - 12 : (hour === 0 ? 12 : hour);
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
}

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// ---- Global Simulation State -------------------------------
const Sim = {
  totalAttendees: 30,
  numGroups: 12,
  meanDwell: 30,
  skipProb: 0.15,
  recogProb: 0.75,
  hostBarIndex: null,
  speedMultiplier: 10,

  simMinute: 0,
  running: false,
  rafId: null,
  lastRealTime: null,

  groups: [],

  map: null,
  barMarkers: [],

  histChart: null,
  histDirty: false,
  discoveryTimes: [],

  firstDiscovery: null,
  allFoundTime: null,

  MAX_SIM_MINUTES: 300,
};

// ---- Map Initialization ------------------------------------
function initMap() {
  if (Sim.map) return;

  Sim.map = L.map('map-container', {
    zoomControl: true,
    attributionControl: true,
    preferCanvas: true,
    minZoom: 13,
  });

  L.tileLayer(
    'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png',
    {
      attribution:
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' +
        ' &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 19,
    }
  ).addTo(Sim.map);

  L.polyline(BARS.map(b => [b.lat, b.lng]), {
    color: '#FFD70066',
    weight: 3,
    dashArray: '6 6',
    opacity: 0.8,
  }).addTo(Sim.map);

  Sim.barMarkers = BARS.map((bar, i) => {
    const icon = makeBarIcon(i, false);
    const marker = L.marker([bar.lat, bar.lng], { icon, zIndexOffset: 200 })
      .addTo(Sim.map)
      .bindTooltip(`<strong>${i + 1}. ${bar.name}</strong>`, {
        permanent: false,
        direction: 'right',
        className: 'bar-tooltip',
      });
    return marker;
  });

  const bounds = L.latLngBounds(BARS.map(b => [b.lat, b.lng]));
  Sim.map.fitBounds(bounds, { padding: [60, 60] });

  setTimeout(() => {
    Sim.map.invalidateSize();
    Sim.map.fitBounds(bounds, { padding: [60, 60] });
    if (Sim.map.getZoom() < 14) {
      Sim.map.setZoom(14);
    }
  }, 200);
}

function makeBarIcon(idx, isHost) {
  if (isHost) {
    return L.divIcon({
      className: '',
      html: `<div class="host-pulse-wrapper">
               <div class="host-pulse-ring"></div>
               <div class="host-pulse-dot">🍌</div>
             </div>`,
      iconSize: [40, 40],
      iconAnchor: [20, 20],
    });
  }
  return L.divIcon({
    className: '',
    html: `<div style="
      width:28px;height:28px;border-radius:50%;
      background:#241e18;border:2px solid #FFD70088;
      color:#FFD700;font-size:12px;font-weight:700;
      display:flex;align-items:center;justify-content:center;
      box-shadow:0 2px 8px rgba(0,0,0,0.6), 0 0 6px #FFD70033;
      font-family:'Fredoka',system-ui,sans-serif;">${idx + 1}</div>`,
    iconSize: [28, 28],
    iconAnchor: [14, 14],
  });
}

function updateBarMarkers(hostIdx) {
  Sim.barMarkers.forEach((marker, i) => {
    marker.setIcon(makeBarIcon(i, i === hostIdx));
  });
}

// ---- Chart Initialization ----------------------------------
function initChart() {
  const canvas = document.getElementById('histogram-canvas');
  const wrapper = document.getElementById('histogram-canvas-wrapper');
  canvas.height = wrapper.clientHeight - 20 || 120;

  const ctx = canvas.getContext('2d');
  Sim.histChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: Array.from({ length: 30 }, (_, i) => `${i * 10}`),
      datasets: [{
        label: 'Groups found',
        data: new Array(30).fill(0),
        backgroundColor: '#32CD3299',
        borderColor: '#32CD32',
        borderWidth: 1.5,
        borderRadius: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: { duration: 0 },
      scales: {
        x: {
          title: { display: true, text: 'Discovery time (sim minutes)', color: '#8a7a6a', font: { size: 11 } },
          ticks: { color: '#8a7a6a', font: { size: 10 }, maxRotation: 0 },
          grid: { color: '#2d2420' },
        },
        y: {
          title: { display: true, text: 'Groups', color: '#8a7a6a', font: { size: 11 } },
          beginAtZero: true,
          ticks: { stepSize: 1, color: '#8a7a6a', font: { size: 10 } },
          grid: { color: '#2d2420' },
        },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#1f1a28',
          borderColor: '#3d2e20',
          borderWidth: 1,
          titleColor: '#e8dfd0',
          bodyColor: '#c4b8a8',
          callbacks: {
            title: (items) => `${items[0].label}–${parseInt(items[0].label) + 10} min`,
            label: (ctx) => ` ${ctx.raw} group${ctx.raw !== 1 ? 's' : ''} discovered`,
          },
        },
      },
    },
  });
}

function rebuildHistogram() {
  const counts = new Array(30).fill(0);
  for (const t of Sim.discoveryTimes) {
    const bin = clamp(Math.floor(t / 10), 0, 29);
    counts[bin]++;
  }
  Sim.histChart.data.datasets[0].data = counts;
  Sim.histChart.update('none');
  Sim.histDirty = false;
}

// ---- Group Placement ----------------------------------------
function assignGroupSizes(totalAttendees, numGroups) {
  const effective = Math.max(totalAttendees, numGroups);
  const base = Math.floor(effective / numGroups);
  const rem = effective % numGroups;
  return Array(numGroups).fill(base).map((s, i) => s + (i < rem ? 1 : 0));
}

// ---- Group Colors ------------------------------------------
const COLORS = {
  waiting:   '#8B7355',
  searching: '#FF8C00',
  tipped:    '#FFD700',
  found:     '#32CD32',
};

function groupColor(g) {
  if (g.phase === 'found')    return COLORS.found;
  if (g.knowsHostBar)         return COLORS.tipped;
  if (g.phase === 'waiting')  return COLORS.waiting;
  return COLORS.searching;
}

// ---- Knowledge Helper --------------------------------------
// Check if a group can deduce the host location from cleared bars
function checkDeduction(g) {
  if (g.knowsHostBar || g.phase === 'found') return;
  if (g.knownClearBars.size >= BARS.length - 1) {
    // Only one bar left — that must be the host
    for (let i = 0; i < BARS.length; i++) {
      if (!g.knownClearBars.has(i)) {
        g.deducedHostBar = i;
        g.knowsHostBar = true;
        return;
      }
    }
  }
}

// ---- Create Groups -----------------------------------------
function createGroups() {
  const sizes = assignGroupSizes(Sim.totalAttendees, Sim.numGroups);

  Sim.groups = sizes.map((size, id) => {
    const arrivalMinute = clamp(gaussianSample(5, 8), 0, 30);
    const startBar = Math.floor(Math.random() * BARS.length);

    const jR = (id % 3 - 1) * 0.00018;
    const jC = (Math.floor(id / 3) % 3 - 1) * 0.00018;
    const startLat = BARS[startBar].lat + jR;
    const startLng = BARS[startBar].lng + jC;

    const marker = L.circleMarker([startLat, startLng], {
      radius: 4 + Math.ceil(size / 2),
      fillColor: COLORS.waiting,
      color: '#FFD70088',
      weight: 1.5,
      fillOpacity: 0.9,
      opacity: 0.9,
    }).addTo(Sim.map);
    marker.bindTooltip(`Group ${id + 1} (${size} ppl)`, { sticky: true });

    return {
      id,
      size,
      arrivalMinute,
      phase: 'waiting',
      currentBarIndex: startBar,
      departureBarIndex: startBar,
      nextBarIndex: null,
      dwellUntil: arrivalMinute + clamp(gaussianSample(Sim.meanDwell, 8), 15, 60),
      arriveAt: null,
      travelStartMinute: null,
      knowsHostBar: false,
      deducedHostBar: null,   // set when deduced via elimination
      foundAtMinute: null,
      knownClearBars: new Set(), // bars this group knows the host is NOT at
      currentLat: startLat,
      currentLng: startLng,
      leafletMarker: marker,
    };
  });
}

function clearGroupMarkers() {
  for (const g of Sim.groups) {
    if (g.leafletMarker) g.leafletMarker.remove();
  }
  Sim.groups = [];
}

// ---- Group State Machine ------------------------------------
function updateGroup(g, t) {
  if (g.phase === 'found') return;

  if (g.phase === 'waiting') {
    if (t >= g.arrivalMinute) {
      g.phase = 'dwelling';
      // Mark starting bar as visited
      if (g.currentBarIndex !== Sim.hostBarIndex) {
        g.knownClearBars.add(g.currentBarIndex);
        checkDeduction(g);
      }
      if (g.currentBarIndex === Sim.hostBarIndex) {
        markFound(g, t);
      }
    }
    return;
  }

  if (g.phase === 'dwelling') {
    if (g.currentBarIndex === Sim.hostBarIndex) {
      markFound(g, t);
      return;
    }
    if (t >= g.dwellUntil) {
      depart(g, t);
    }
    return;
  }

  if (g.phase === 'traveling') {
    // If group deduced/learned host while traveling, redirect immediately
    if (g.knowsHostBar && g.nextBarIndex !== getHostTarget(g)) {
      const target = getHostTarget(g);
      if (target !== null && target !== g.nextBarIndex) {
        // Redirect: start traveling to host from current interpolated position
        g.departureBarIndex = g.currentBarIndex;
        g.nextBarIndex = target;
        g.travelStartMinute = t;
        // Estimate remaining travel from current position
        g.arriveAt = t + TRAVEL_TIME[g.currentBarIndex][target];
      }
    }

    if (t >= g.arriveAt) {
      g.currentBarIndex = g.nextBarIndex;
      g.nextBarIndex = null;
      g.phase = 'dwelling';
      g.dwellUntil = t + clamp(gaussianSample(Sim.meanDwell, 8), 15, 60);
      // Mark this bar as visited
      if (g.currentBarIndex !== Sim.hostBarIndex) {
        g.knownClearBars.add(g.currentBarIndex);
        checkDeduction(g);
      }
      if (g.currentBarIndex === Sim.hostBarIndex) {
        markFound(g, t);
      }
    }
  }
}

function getHostTarget(g) {
  if (g.deducedHostBar !== null) return g.deducedHostBar;
  return Sim.hostBarIndex;
}

function markFound(g, t) {
  g.phase = 'found';
  g.foundAtMinute = t;
  g.currentBarIndex = Sim.hostBarIndex;
  Sim.discoveryTimes.push(t);
  Sim.histDirty = true;
  if (Sim.firstDiscovery === null) Sim.firstDiscovery = t;
}

// ---- Movement Logic ----------------------------------------
// Pick next bar: prefer adjacent uncleared, with skip chance
function chooseNextBar(g) {
  const cur = g.currentBarIndex;
  const allBars = Array.from({ length: BARS.length }, (_, i) => i);

  // Bars we haven't cleared (host might be there)
  const unclearedBars = allBars.filter(i => i !== cur && !g.knownClearBars.has(i));

  // If no uncleared bars left, something went wrong — just stay
  if (unclearedBars.length === 0) return null;

  // 15% chance to skip adjacent and pick uniformly from all uncleared
  if (Math.random() < Sim.skipProb) {
    return pickRandom(unclearedBars);
  }

  // Adjacent bars (cur-1, cur+1) that exist and aren't cleared
  const adjacent = [];
  if (cur > 0 && !g.knownClearBars.has(cur - 1)) adjacent.push(cur - 1);
  if (cur < BARS.length - 1 && !g.knownClearBars.has(cur + 1)) adjacent.push(cur + 1);

  if (adjacent.length > 0) {
    // Pick randomly between available adjacent uncleared bars
    return pickRandom(adjacent);
  }

  // Both adjacent are cleared (or at edge) — go to nearest uncleared bar
  unclearedBars.sort((a, b) => Math.abs(a - cur) - Math.abs(b - cur));
  return unclearedBars[0];
}

function depart(g, t) {
  let nextBar;

  if (g.knowsHostBar) {
    // Know exact host location — beeline there (after finishing drink)
    nextBar = getHostTarget(g);
    if (nextBar === g.currentBarIndex) {
      markFound(g, t);
      return;
    }
  } else {
    nextBar = chooseNextBar(g);
    if (nextBar === null) {
      // All bars cleared but no host found? Shouldn't happen, but dwell as fallback
      g.dwellUntil = t + clamp(gaussianSample(Sim.meanDwell, 8), 15, 60);
      return;
    }
  }

  g.departureBarIndex = g.currentBarIndex;
  g.nextBarIndex = nextBar;
  g.travelStartMinute = t;
  g.arriveAt = t + TRAVEL_TIME[g.currentBarIndex][nextBar];
  g.phase = 'traveling';
}

// ---- Information Sharing -----------------------------------

// At bars: groups dwelling at the same bar share knowledge
function resolveBarSharing() {
  const atBar = {};
  for (const g of Sim.groups) {
    if (g.phase === 'dwelling' || g.phase === 'found') {
      const b = g.currentBarIndex;
      if (!atBar[b]) atBar[b] = [];
      atBar[b].push(g);
    }
  }

  for (const b in atBar) {
    const here = atBar[b];
    if (here.length < 2) continue;

    // For each pair, check recognition and share info
    for (let i = 0; i < here.length; i++) {
      for (let j = i + 1; j < here.length; j++) {
        const a = here[i];
        const bGroup = here[j];

        // Recognition check — do they know each other?
        if (Math.random() >= Sim.recogProb) continue;

        // Share cleared bars (both directions)
        shareKnowledge(a, bGroup);
      }
    }
  }
}

// On walks: groups physically close share knowledge
function resolveWalkSharing() {
  const active = Sim.groups.filter(
    g => g.phase === 'traveling' || g.phase === 'dwelling'
  );

  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];

      const dlat = a.currentLat - b.currentLat;
      const dlng = a.currentLng - b.currentLng;
      const dist = Math.sqrt(dlat * dlat + dlng * dlng);

      if (dist < PROXIMITY_DEG) {
        if (Math.random() < Sim.recogProb) {
          shareKnowledge(a, b);
        }
      }
    }
  }
}

// Share all knowledge between two groups
function shareKnowledge(a, b) {
  // If either has found the host or knows exact location, share that
  if (a.phase === 'found' || a.knowsHostBar) {
    if (!b.knowsHostBar && b.phase !== 'found') {
      b.knowsHostBar = true;
      b.deducedHostBar = Sim.hostBarIndex;
    }
  }
  if (b.phase === 'found' || b.knowsHostBar) {
    if (!a.knowsHostBar && a.phase !== 'found') {
      a.knowsHostBar = true;
      a.deducedHostBar = Sim.hostBarIndex;
    }
  }

  // Share cleared bars — union both sets
  const unionClear = new Set([...a.knownClearBars, ...b.knownClearBars]);
  a.knownClearBars = new Set(unionClear);
  b.knownClearBars = new Set(unionClear);

  // Check if either can now deduce the host location
  checkDeduction(a);
  checkDeduction(b);
}

// ---- Marker Position Interpolation -------------------------
function updateMarkerPositions() {
  for (const g of Sim.groups) {
    let lat, lng;

    if (g.phase === 'traveling' && g.travelStartMinute !== null) {
      const totalTravel = TRAVEL_TIME[g.departureBarIndex][g.nextBarIndex];
      const elapsed = Sim.simMinute - g.travelStartMinute;
      const progress = totalTravel > 0 ? clamp(elapsed / totalTravel, 0, 1) : 1;
      const from = BARS[g.departureBarIndex];
      const to   = BARS[g.nextBarIndex];
      lat = from.lat + (to.lat - from.lat) * progress;
      lng = from.lng + (to.lng - from.lng) * progress;
    } else {
      const bar = BARS[g.currentBarIndex];
      lat = bar.lat + (g.id % 3 - 1) * 0.00018;
      lng = bar.lng + (Math.floor(g.id / 3) % 3 - 1) * 0.00018;
    }

    g.currentLat = lat;
    g.currentLng = lng;

    g.leafletMarker.setLatLng([lat, lng]);
    g.leafletMarker.setStyle({ fillColor: groupColor(g) });
  }
}

// ---- Stats Panel -------------------------------------------
function updateStats() {
  const found = Sim.groups.filter(g => g.phase === 'found').length;
  const total = Sim.groups.length;

  document.getElementById('stat-time').textContent = formatTime(Sim.simMinute);
  document.getElementById('stat-found').textContent = `${found} / ${total}`;
  document.getElementById('stat-first').textContent = formatTime(Sim.firstDiscovery);
  document.getElementById('stat-allfound').textContent = formatTime(Sim.allFoundTime);
  document.getElementById('stat-last').textContent = Sim.discoveryTimes.length > 0
    ? formatTime(Math.max(...Sim.discoveryTimes))
    : '—';

  if (Sim.discoveryTimes.length > 0) {
    const sorted = [...Sim.discoveryTimes].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2 === 0
      ? (sorted[mid - 1] + sorted[mid]) / 2
      : sorted[mid];
    document.getElementById('stat-median').textContent = formatTime(median);
  } else {
    document.getElementById('stat-median').textContent = '—';
  }

  const pct = total > 0 ? (found / total) * 100 : 0;
  document.getElementById('progress-bar').style.width = pct + '%';
}

// ---- Confetti Celebration ----------------------------------
function launchCelebration() {
  if (typeof confetti !== 'function') return;

  const duration = 3000;
  const end = Date.now() + duration;
  const colors = ['#FFD700', '#FFA500', '#32CD32', '#FFE033', '#FF8C00'];

  (function frame() {
    confetti({
      particleCount: 5,
      angle: 60,
      spread: 55,
      origin: { x: 0 },
      colors: colors,
    });
    confetti({
      particleCount: 5,
      angle: 120,
      spread: 55,
      origin: { x: 1 },
      colors: colors,
    });
    if (Date.now() < end) {
      requestAnimationFrame(frame);
    }
  })();

  document.getElementById('app').classList.add('sim-complete');
}

// ---- Termination Check -------------------------------------
function checkTermination() {
  const allFound = Sim.groups.every(g => g.phase === 'found');
  if (allFound && Sim.allFoundTime === null) {
    Sim.allFoundTime = Sim.simMinute;
  }

  const timedOut = Sim.simMinute >= Sim.MAX_SIM_MINUTES;

  if (allFound || timedOut) {
    stopSim();
    const msg = allFound
      ? '— Everyone found the host! 🍌🎉'
      : '— Time limit (300 min) reached';
    document.getElementById('sim-status').textContent = msg;
    document.getElementById('btn-run').textContent = '🍌 Run Again';
    document.getElementById('btn-run').disabled = false;
    updateStats();
    if (Sim.histDirty) rebuildHistogram();

    if (allFound) {
      launchCelebration();
    }
  }
}

// ---- Animation Loop ----------------------------------------
function animLoop(timestamp) {
  if (!Sim.running) return;

  if (Sim.lastRealTime === null) {
    Sim.lastRealTime = timestamp;
    Sim.rafId = requestAnimationFrame(animLoop);
    return;
  }

  const rawMs = timestamp - Sim.lastRealTime;
  const cappedMs = Math.min(rawMs, 33);
  Sim.lastRealTime = timestamp;

  const deltaSimMin = (cappedMs / 1000) * Sim.speedMultiplier;
  Sim.simMinute += deltaSimMin;

  for (const g of Sim.groups) {
    updateGroup(g, Sim.simMinute);
  }

  updateMarkerPositions();

  resolveBarSharing();
  resolveWalkSharing();

  for (const g of Sim.groups) {
    g.leafletMarker.setStyle({ fillColor: groupColor(g) });
  }

  updateStats();
  if (Sim.histDirty) rebuildHistogram();

  checkTermination();

  if (Sim.running) {
    Sim.rafId = requestAnimationFrame(animLoop);
  }
}

// ---- Start / Stop / Reset ----------------------------------
function startSim() {
  Sim.totalAttendees  = parseInt(document.getElementById('attendees').value);
  Sim.numGroups       = parseInt(document.getElementById('num-groups').value);
  Sim.meanDwell       = parseInt(document.getElementById('dwell-time').value);
  Sim.skipProb        = parseInt(document.getElementById('skip-prob').value) / 100;
  Sim.recogProb       = parseInt(document.getElementById('recog-prob').value) / 100;
  Sim.speedMultiplier = parseInt(document.getElementById('speed').value);

  const randomHost = document.getElementById('random-host').checked;
  Sim.hostBarIndex = randomHost
    ? Math.floor(Math.random() * BARS.length)
    : parseInt(document.getElementById('host-bar-picker').value);

  Sim.simMinute       = 0;
  Sim.firstDiscovery  = null;
  Sim.allFoundTime    = null;
  Sim.discoveryTimes  = [];
  Sim.histDirty       = false;

  rebuildHistogram();
  clearGroupMarkers();
  updateBarMarkers(Sim.hostBarIndex);

  document.getElementById('host-display-text').textContent = BARS[Sim.hostBarIndex].name;
  document.getElementById('sim-status').textContent = '— Running…';
  document.getElementById('btn-run').disabled = true;
  document.getElementById('btn-run').textContent = '⏳ Running…';
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('app').classList.remove('sim-complete');

  createGroups();

  Sim.running = true;
  Sim.lastRealTime = null;
  Sim.rafId = requestAnimationFrame(animLoop);
}

function stopSim() {
  Sim.running = false;
  if (Sim.rafId) {
    cancelAnimationFrame(Sim.rafId);
    Sim.rafId = null;
  }
}

function resetSim() {
  stopSim();
  clearGroupMarkers();

  Sim.simMinute       = 0;
  Sim.firstDiscovery  = null;
  Sim.allFoundTime    = null;
  Sim.discoveryTimes  = [];
  Sim.histDirty       = false;

  updateBarMarkers(-1);
  document.getElementById('host-display-text').textContent = '—';
  document.getElementById('sim-status').textContent = '— Ready';
  document.getElementById('btn-run').textContent = '🍌 Run';
  document.getElementById('btn-run').disabled = false;
  document.getElementById('progress-bar').style.width = '0%';
  document.getElementById('app').classList.remove('sim-complete');

  document.getElementById('stat-time').textContent    = '3:00 PM';
  document.getElementById('stat-found').textContent   = '0 / 0';
  document.getElementById('stat-first').textContent   = '—';
  document.getElementById('stat-allfound').textContent = '—';
  document.getElementById('stat-last').textContent    = '—';
  document.getElementById('stat-median').textContent  = '—';

  rebuildHistogram();
}

// ---- Slider Bindings ---------------------------------------
function bindSliders() {
  const defs = [
    { id: 'attendees',  valId: 'attendees-val' },
    { id: 'num-groups', valId: 'groups-val' },
    { id: 'dwell-time', valId: 'dwell-val' },
    { id: 'skip-prob',  valId: 'skip-val' },
    { id: 'recog-prob', valId: 'recog-val' },
    { id: 'speed',      valId: 'speed-val' },
  ];

  for (const { id, valId } of defs) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.addEventListener('input', () => {
      document.getElementById(valId).textContent = el.value;
      syncDerived();
    });
  }

  document.getElementById('speed').addEventListener('input', (e) => {
    const spm = parseInt(e.target.value);
    document.getElementById('speed-hint').textContent = (60 / spm).toFixed(1) + 's';
  });

  document.getElementById('random-host').addEventListener('change', (e) => {
    document.getElementById('host-bar-picker').disabled = e.target.checked;
  });
}

function syncDerived() {
  const att = parseInt(document.getElementById('attendees').value);
  const grp = parseInt(document.getElementById('num-groups').value);
  document.getElementById('avg-size').textContent = (att / grp).toFixed(1);
}

// ---- Entry Point -------------------------------------------
document.addEventListener('DOMContentLoaded', () => {
  initMap();
  initChart();
  bindSliders();
  syncDerived();
  updateBarMarkers(-1);

  document.getElementById('btn-run').addEventListener('click', startSim);
  document.getElementById('btn-reset').addEventListener('click', resetSim);

  window.addEventListener('resize', () => {
    if (Sim.map) Sim.map.invalidateSize();
  });
});
