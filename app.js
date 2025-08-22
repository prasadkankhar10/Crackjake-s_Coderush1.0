// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// NOAA endpoints
const PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const MAG_URL    = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';

// Config / thresholds (tweak for demo)
const POLL_INTERVAL_MS = 60 * 1000; // 60s
const BUFFER_MAX = 3000;            // keep last n samples in memory
const DELTA_WINDOW = 30;            // approx last 30 samples (~30 min if 1/min) to compute deltaV
const THRESHOLDS = {
  speed_high: 500,    // km/s
  density_high: 10,   // p/cm3
  bz_south: -10,      // nT (more negative => stronger southward)
  deltaV_min: 100     // km/s jump within DELTA_WINDOW => shock
};

// In-memory buffers
let plasmaBuffer = []; // entries: {timeISO, density, speed, temp}
let magBuffer = [];    // entries: {timeISO, bx, by, bz}
let detections = [];   // {id, timeISO, speed, density, bz, deltaV, forecast_hours, intensity}

// Helper: parse NOAA JSON rows -> arrays (first row is header)
function parseNOAAData(jsonRows) {
  // NOAA returns array-of-arrays, where row[0] are column names
  // We will assume standard ordering; for plasma: [time_tag, density, speed, temperature]
  // for mag: [time_tag, bx, by, bz]
  return jsonRows.slice(1).map(r => r); // leave raw; we'll pick indices later
}

function safeNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// Convert NOAA row to object (plasma)
function plasmaRowToObj(row) {
  // NOAA plasma row: [time_tag, proton_density, speed, temperature]
  return {
    timeISO: row[0],
    density: safeNum(row[1]),
    speed: safeNum(row[2]),
    temp: safeNum(row[3])
  };
}

// Convert mag row to object (mag)
function magRowToObj(row) {
  // NOAA mag row: [time_tag, bx, by, bz]
  return {
    timeISO: row[0],
    bx: safeNum(row[1]),
    by: safeNum(row[2]),
    bz: safeNum(row[3])
  };
}

// Forecast arrival (in hours) approx: 1 AU / speed
function forecastArrivalHours(speed_km_s) {
  if (!speed_km_s || speed_km_s <= 0) return null;
  const AU_km = 149_597_870.7; // km (1 AU) ~1.495978707e8 km
  const hours = AU_km / speed_km_s / 3600;
  return Math.round(hours);
}

// Determine intensity label
function intensityFromSpeed(speed) {
  if (speed > 800) return 'Very Strong';
  if (speed > 700) return 'Strong';
  if (speed > 600) return 'Moderate';
  if (speed > 500) return 'Mild';
  return 'Nominal';
}

// Core detector (runs on buffers)
function runDetection() {
  const newDetections = [];
  // iterate over recent buffer, check conditions
  for (let i = 0; i < plasmaBuffer.length; i++) {
    const p = plasmaBuffer[i];
    const m = magBuffer[i] || {};
    if (!p || !m) continue;

    const speed = p.speed;
    const density = p.density;
    const bz = m.bz;

    if (speed == null || density == null || bz == null) continue;

    // deltaV: compare to earlier sample DELTA_WINDOW back (or compute average)
    let deltaV = null;
    const j = i - DELTA_WINDOW;
    if (j >= 0 && plasmaBuffer[j]) {
      deltaV = speed - plasmaBuffer[j].speed;
    } else if (plasmaBuffer.length > 2) {
      // fallback: compare to average of previous up-to-5 samples
      const k = Math.max(0, i - 5);
      let sum = 0, cnt = 0;
      for (let t = k; t < i; t++) {
        const s = plasmaBuffer[t].speed;
        if (s != null) { sum += s; cnt++; }
      }
      if (cnt > 0) deltaV = speed - (sum / cnt);
    }

    // Condition checks
    const condHighSpeed = speed > THRESHOLDS.speed_high;
    const condDensity = density > THRESHOLDS.density_high;
    const condSouthBz = bz < THRESHOLDS.bz_south;
    const condDeltaV = deltaV != null && deltaV > THRESHOLDS.deltaV_min;

    // Use OR of (deltaV shock) AND supportive conditions OR all three supportive conditions
    const isCME = (condDeltaV && (condHighSpeed || condDensity)) || (condHighSpeed && condDensity && condSouthBz);

    if (isCME) {
      // create a unique-ish id by timestamp + speed
      const id = `${p.timeISO}_${Math.round(speed)}`;
      // avoid duplicates
      if (!detections.some(d => d.id === id) && !newDetections.some(d => d.id === id)) {
        const arrivalHrs = forecastArrivalHours(speed);
        const intensity = intensityFromSpeed(speed);
        newDetections.push({
          id,
          timeISO: p.timeISO,
          speed,
          density,
          bz,
          deltaV: deltaV == null ? null : Math.round(deltaV),
          forecast_arrival_hours: arrivalHrs,
          intensity
        });
      }
    }
  }

  // Append new detections to global list (and keep recent)
  if (newDetections.length) {
    detections = detections.concat(newDetections);
    // keep only last 100 detections for memory
    if (detections.length > 100) detections = detections.slice(-100);
    // log
    newDetections.forEach(d => {
      console.log('🚨 CME DETECTED:', d.timeISO, 'speed=', d.speed, 'density=', d.density, 'bz=', d.bz, 'deltaV=', d.deltaV, 'arrive(hrs)=', d.forecast_arrival_hours, 'intensity=', d.intensity);
    });
  }

  return newDetections;
}

// Poll NOAA every POLL_INTERVAL_MS
async function pollNOAA() {
  try {
    const [plasmaRes, magRes] = await Promise.all([
      axios.get(PLASMA_URL, { timeout: 20_000 }),
      axios.get(MAG_URL, { timeout: 20_000 })
    ]);
    // data are arrays-of-arrays; first row header
    const rawPlasma = plasmaRes.data;
    const rawMag = magRes.data;

    // Ensure both same length; NOAA sometimes has slightly different sample counts: we'll align by timestamp.
    // Build maps by timestamp to merge reliably.
    const plasmaRows = rawPlasma.slice(1).map(plasmaRowToObj);
    const magRows = rawMag.slice(1).map(magRowToObj);

    // Create dict for mag by time
    const magByTime = new Map();
    for (const m of magRows) if (m.timeISO) magByTime.set(m.timeISO, m);

    // Merge: use plasma timestamps (primary) and find matching mag row for same timestamp
    for (const p of plasmaRows) {
      const m = magByTime.get(p.timeISO) || { bx: null, by: null, bz: null, timeISO: p.timeISO };
      // push to buffers
      plasmaBuffer.push(p);
      magBuffer.push(m);
      // trim buffers
      if (plasmaBuffer.length > BUFFER_MAX) plasmaBuffer.shift();
      if (magBuffer.length > BUFFER_MAX) magBuffer.shift();
    }

    // Run detection on merged buffers
    runDetection();

  } catch (err) {
    console.error('Error polling NOAA:', err.message || err);
  }
}

// Start polling immediately and then every interval
(async () => {
  console.log('Starting initial NOAA poll...');
  await pollNOAA();
  setInterval(pollNOAA, POLL_INTERVAL_MS);
})();

// --- REST endpoints ---

// return last N samples
app.get('/latest', (req, res) => {
  const n = Number(req.query.n) || 500;
  const plasma = plasmaBuffer.slice(-n);
  const mag = magBuffer.slice(-n);
  res.json({ plasma, mag, last_polled: plasmaBuffer.length ? plasmaBuffer[plasmaBuffer.length-1].timeISO : null });
});

// return detected events
app.get('/events', (req, res) => {
  res.json({ detections });
});

// run detection on demand (scan buffers now)
app.get('/cme-detect', (req, res) => {
  const newDet = runDetection();
  res.json({ newDetections: newDet, allDetections: detections });
});

// basic health
app.get('/health', (req, res) => res.json({ ok: true, plasma_samples: plasmaBuffer.length }));

// serve frontend: index.html in /public
app.get('/', (req, res) => {
  res.render(path.join(__dirname, 'views', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 CME Detector server listening on http://localhost:${PORT}`));
