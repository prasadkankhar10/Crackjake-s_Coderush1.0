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

// Config thresholds
const POLL_INTERVAL_MS = 60 * 1000; 
const BUFFER_MAX = 3000;            
const DELTA_WINDOW = 30;            
const THRESHOLDS = {
  speed_high: 500,    
  density_high: 10,   
  bz_south: -10,      
  deltaV_min: 100     
};

// Buffers
let plasmaBuffer = [];
let magBuffer = [];
let detections = [];

// Helpers
function safeNum(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}
function plasmaRowToObj(row) {
  return { timeISO: row[0], density: safeNum(row[1]), speed: safeNum(row[2]), temp: safeNum(row[3]) };
}
function magRowToObj(row) {
  return { timeISO: row[0], bx: safeNum(row[1]), by: safeNum(row[2]), bz: safeNum(row[3]) };
}
function forecastArrivalHours(speed_km_s) {
  if (!speed_km_s || speed_km_s <= 0) return null;
  const AU_km = 149_597_870.7;
  return Math.round(AU_km / speed_km_s / 3600);
}
function intensityFromSpeed(speed) {
  if (speed > 3000) return 'Very Strong';
  if (speed > 1500) return 'Strong';
  if (speed > 1200) return 'Moderate';
  if (speed > 400) return 'Mild';
  return 'Nominal';
}

// Detector
function runDetection() {
  const newDetections = [];
  for (let i = 0; i < plasmaBuffer.length; i++) {
    const p = plasmaBuffer[i];
    const m = magBuffer[i] || {};
    if (!p || !m) continue;

    const { speed, density } = p;
    const { bz } = m;
    if (speed == null || density == null || bz == null) continue;

    let deltaV = null;
    const j = i - DELTA_WINDOW;
    if (j >= 0 && plasmaBuffer[j]) {
      deltaV = speed - plasmaBuffer[j].speed;
    }

    const condHighSpeed = speed > THRESHOLDS.speed_high;
    const condDensity = density > THRESHOLDS.density_high;
    const condSouthBz = bz < THRESHOLDS.bz_south;
    const condDeltaV = deltaV != null && deltaV > THRESHOLDS.deltaV_min;

    const isCME = (condDeltaV && (condHighSpeed || condDensity)) || 
                  (condHighSpeed && condDensity && condSouthBz);

    if (isCME) {
      const id = `${p.timeISO}_${Math.round(speed)}`;
      if (!detections.some(d => d.id === id) && !newDetections.some(d => d.id === id)) {
        newDetections.push({
          id,
          timeISO: p.timeISO,
          speed,
          density,
          bz,
          deltaV: deltaV == null ? null : Math.round(deltaV),
          forecast_arrival_hours: forecastArrivalHours(speed),
          intensity: intensityFromSpeed(speed)
        });
      }
    }
  }
  if (newDetections.length) {
    detections = detections.concat(newDetections).slice(-100);
    newDetections.forEach(d => {
      console.log('🚨 CME DETECTED:', d);
    });
  }
  return newDetections;
}

// Poll NOAA
async function pollNOAA() {
  try {
    const [plasmaRes, magRes] = await Promise.all([
      axios.get(PLASMA_URL, { timeout: 20_000 }),
      axios.get(MAG_URL, { timeout: 20_000 })
    ]);
    const plasmaRows = plasmaRes.data.slice(1).map(plasmaRowToObj);
    const magRows = magRes.data.slice(1).map(magRowToObj);

    const magByTime = new Map(magRows.map(m => [m.timeISO, m]));

    for (const p of plasmaRows) {
      const m = magByTime.get(p.timeISO) || { bx: null, by: null, bz: null, timeISO: p.timeISO };
      plasmaBuffer.push(p);
      magBuffer.push(m);
      if (plasmaBuffer.length > BUFFER_MAX) plasmaBuffer.shift();
      if (magBuffer.length > BUFFER_MAX) magBuffer.shift();
    }
    runDetection();
  } catch (err) {
    console.error('Error polling NOAA:', err.message || err);
  }
}

(async () => {
  console.log('Starting NOAA poll...');
  await pollNOAA();
  setInterval(pollNOAA, POLL_INTERVAL_MS);
})();

// REST endpoints
app.get('/latest', (req, res) => {
  const n = Number(req.query.n) || 500;
  res.json({ 
    plasma: plasmaBuffer.slice(-n), 
    mag: magBuffer.slice(-n), 
    last_polled: plasmaBuffer.at(-1)?.timeISO || null 
  });
});
app.get('/events', (req, res) => res.json({ detections }));
app.get('/cme-detect', (req, res) => res.json({ new: runDetection(), all: detections }));
app.get('/health', (req, res) => res.json({ ok: true, plasma_samples: plasmaBuffer.length }));

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 CME Detector server running on http://localhost:${PORT}`));
