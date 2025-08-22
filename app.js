// server.js
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB helper (optional)
let mongoDb = null;
try {
  var dbHelper = require('./lib/db');
} catch (e) { dbHelper = null; }

// NOAA endpoints
const PLASMA_URL = 'https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json';
const MAG_URL    = 'https://services.swpc.noaa.gov/products/solar-wind/mag-1-day.json';

// Config thresholds
const POLL_INTERVAL_MS = 60 * 1000; 
const BUFFER_MAX = 3000;            
const DELTA_WINDOW = 30;            
const BZ_INTEGRAL_WINDOW = 60;      // samples to integrate Bz over (~minutes)
const FORECAST_STEPS = 6;           // how many steps to forecast (simple EWMA)
const EWMA_ALPHA = 0.25;            // smoothing factor for EWMA forecasts
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

// --- Derived helpers ---
function clamp01(v){ return Math.max(0, Math.min(1, v)); }
function computePdyn(density, speed){
  // dynamic pressure approximation (nPa) using proton mass constant
  // Pdyn = 1.6726e-6 * n (cm^-3) * speed(km/s)^2
  if (density == null || speed == null) return null;
  return 1.6726e-6 * density * (speed*speed);
}
function computeBzIntegral(magBuf, idx, windowSamples){
  if (!magBuf || magBuf.length === 0) return 0;
  const start = Math.max(0, idx - windowSamples + 1);
  let sum = 0;
  for (let i = start; i <= idx; i++){
    const bz = magBuf[i]?.bz; if (bz == null) continue; sum += Math.max(0, -bz); // only southward contributes
  }
  return Math.round(sum*100)/100; // nT-sample units (approx)
}

function simpleEwmaForecast(arr, alpha=EWMA_ALPHA, steps=FORECAST_STEPS){
  // arr: numeric array (most recent last) -> produce `steps` forecasts
  const out = [];
  if (!Array.isArray(arr) || arr.length === 0) return out;
  // initialize with last EWMA value
  let s = arr[0];
  for (let i=1;i<arr.length;i++) s = alpha*arr[i] + (1-alpha)*s;
  for (let k=0;k<steps;k++){
    // forecast is simply the last EWMA value (constant); could optionally decay
    out.push(Math.round(s));
  }
  return out;
}

function computeScoreAndSeverity({speed, density, bz, deltaV}){
  // normalize features and compute a 0..1 score
  const speedNorm = clamp01(( (speed||0) - 400 ) / (2000 - 400));
  const densityNorm = clamp01(( (density||0) - 2 ) / (50 - 2));
  const bzNorm = bz != null && bz < 0 ? clamp01((-bz) / 50) : 0;
  const deltaVNorm = deltaV != null ? clamp01(deltaV / 500) : 0;
  const score = Math.max(0, Math.min(1, (
    0.35*speedNorm + 0.30*deltaVNorm + 0.20*densityNorm + 0.15*bzNorm
  )));
  let severity_label = 'Nominal';
  if (score > 0.75) severity_label = 'Strong';
  else if (score > 0.5) severity_label = 'Moderate';
  else if (score > 0.25) severity_label = 'Mild';
  const severity_class = score > 0.6 ? 'crit' : (score > 0.3 ? 'warn' : 'info');
  return { score: Math.round(score*100)/100, severity_label, severity_class };
}

function detectAnomalyAt(bufs, idx){
  // simple z-score based anomaly: compute mean/std over prior window and check current
  const WIN = 60; // use last 60 samples
  const s = Math.max(0, idx-WIN);
  const out = { speed:false, bz:false, density:false, triggers: [] };
  // helper
  function zCheck(arr, field){
    const vals = [];
    for (let i=s;i<idx;i++){ const v = arr[i]?.[field]; if (v != null) vals.push(v); }
    if (vals.length < 8) return null;
    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
    const sd = Math.sqrt(vals.reduce((a,b)=>a+((b-mean)**2),0)/vals.length) || 0.00001;
    const cur = arr[idx]?.[field]; if (cur == null) return null;
    const z = (cur - mean)/sd;
    return {z, mean, sd, cur};
  }
  const zSpeed = zCheck(bufs.plasma, 'speed'); if (zSpeed && Math.abs(zSpeed.z) > 3){ out.speed=true; out.triggers.push({metric:'speed', z:Math.round(zSpeed.z*100)/100}); }
  const zBz = zCheck(bufs.mag, 'bz'); if (zBz && Math.abs(zBz.z) > 3){ out.bz=true; out.triggers.push({metric:'bz', z:Math.round(zBz.z*100)/100}); }
  const zD = zCheck(bufs.plasma, 'density'); if (zD && Math.abs(zD.z) > 3){ out.density=true; out.triggers.push({metric:'density', z:Math.round(zD.z*100)/100}); }
  out.isAnomaly = out.triggers.length > 0;
  return out;
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
        // compute derived features
        const pdyn = computePdyn(density, speed);
        const bz_integral = computeBzIntegral(magBuffer, i, BZ_INTEGRAL_WINDOW);
        const { score, severity_label, severity_class } = computeScoreAndSeverity({speed,density,bz,deltaV});
        const anomaly = detectAnomalyAt({ plasma: plasmaBuffer, mag: magBuffer }, i);

        newDetections.push({
          id,
          timeISO: p.timeISO,
          speed,
          density,
          bz,
          deltaV: deltaV == null ? null : Math.round(deltaV),
          forecast_arrival_hours: forecastArrivalHours(speed),
          intensity: intensityFromSpeed(speed),
          pdyn: pdyn == null ? null : Math.round(pdyn*100)/100,
          bz_integral,
          score,
          severity_label,
          severity_class,
          anomaly
        });
      }
    }
  }
  if (newDetections.length) {
    detections = detections.concat(newDetections).slice(-100);
    newDetections.forEach(d => {
      console.log('🚨 CME DETECTED:', d);
      // persist to mongo if connected
      if (mongoDb) {
        try { mongoDb.collection('detections').updateOne({ id: d.id }, { $set: d }, { upsert: true }).catch(()=>{}); } catch(e) { /* ignore */ }
      }
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
    // persist raw rows to mongo if available
    if (mongoDb) {
      try {
        const pOps = plasmaRows.map(r => ({ updateOne: { filter: { timeISO: r.timeISO }, update: { $set: r }, upsert: true } }));
        const mOps = magRows.map(r => ({ updateOne: { filter: { timeISO: r.timeISO }, update: { $set: r }, upsert: true } }));
        if (pOps.length) await mongoDb.collection('plasma').bulkWrite(pOps, { ordered: false });
        if (mOps.length) await mongoDb.collection('mag').bulkWrite(mOps, { ordered: false });
      } catch (e) { console.warn('mongo bulk upsert failed:', e.message || e); }
    }
    runDetection();
  } catch (err) {
    console.error('Error polling NOAA:', err.message || err);
  }
}

(async () => {
  console.log('Starting NOAA poll...');
  // connect to MongoDB if available
  if (dbHelper) {
    try { mongoDb = await dbHelper.connect(); console.log('Connected to MongoDB'); } catch (e) { console.warn('MongoDB connect failed:', e.message || e); }
  }
  await pollNOAA();
  setInterval(pollNOAA, POLL_INTERVAL_MS);
})();

// REST endpoints
app.get('/latest', (req, res) => {
  const n = Number(req.query.n) || 500;
  // include short EWMA forecasts for speed and bz
  const plasmaSlice = plasmaBuffer.slice(-n);
  const magSlice = magBuffer.slice(-n);
  const speeds = plasmaSlice.map(p => p.speed).filter(v=>v!=null);
  const bzs = magSlice.map(m => m.bz).filter(v=>v!=null);
  const speed_forecast = simpleEwmaForecast(speeds);
  const bz_forecast = simpleEwmaForecast(bzs);
  res.json({ 
    plasma: plasmaSlice, 
    mag: magSlice, 
    last_polled: plasmaBuffer.at(-1)?.timeISO || null,
    forecast: { speed: speed_forecast, bz: bz_forecast }
  });
});
app.get('/events', (req, res) => res.json({ detections }));

// quick predict endpoint: returns short forecasts and a simple alert summary
app.get('/predict', (req, res) => {
  const recent = Number(req.query.n) || 200;
  const plasmaSlice = plasmaBuffer.slice(-recent);
  const magSlice = magBuffer.slice(-recent);
  const speeds = plasmaSlice.map(p => p.speed).filter(v=>v!=null);
  const bzs = magSlice.map(m => m.bz).filter(v=>v!=null);
  const speed_forecast = simpleEwmaForecast(speeds);
  const bz_forecast = simpleEwmaForecast(bzs);

  // quick risk score from last sample
  const lastP = plasmaBuffer.at(-1) || {};
  const lastM = magBuffer.at(-1) || {};
  const deltaV = null; // can't easily compute here without index; keep null for now
  const { score, severity_label, severity_class } = computeScoreAndSeverity({ speed: lastP.speed, density: lastP.density, bz: lastM.bz, deltaV });
  const anomaly = detectAnomalyAt({ plasma: plasmaBuffer, mag: magBuffer }, plasmaBuffer.length-1);

  res.json({
    forecast: { speed: speed_forecast, bz: bz_forecast },
    quick: { score, severity_label, severity_class, anomaly }
  });
});
app.get('/cme-detect', (req, res) => res.json({ new: runDetection(), all: detections }));
app.get('/health', (req, res) => res.json({ ok: true, plasma_samples: plasmaBuffer.length }));

// Export endpoint: /export?format=json|csv&limit=1000
app.get('/export', async (req, res) => {
  const format = (req.query.format || 'json').toLowerCase();
  const limit = Math.min(50000, Number(req.query.limit) || 1000);
  // columns for CSV export
  const cols = ['id','timeISO','speed','density','bz','deltaV','pdyn','bz_integral','score','severity_label','severity_class','intensity','forecast_arrival_hours'];

  // helper to escape CSV values
  function csvEscape(v){
    if (v == null) return '';
    const s = String(v);
    if (s.includes('"') || s.includes(',') || s.includes('\n') || s.includes('\r')) return '"' + s.replace(/"/g,'""') + '"';
    return s;
  }

  // JSON path: simple (small) response
  if (format === 'json') {
    let rows = [];
    if (mongoDb) {
      try { rows = await mongoDb.collection('detections').find({}).sort({ timeISO: -1 }).limit(limit).toArray(); } catch(e){ console.warn('mongo export failed:', e.message || e); rows = []; }
    }
    if (!rows.length) rows = detections.slice(-limit);
    res.setHeader('Content-Disposition', 'attachment; filename="detections.json"');
    return res.json(rows);
  }

  // CSV streaming path: stream cursor from MongoDB when available to avoid buffering large exports
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="detections.csv"');
  // BOM for Excel
  res.write('\uFEFF');
  // header row
  res.write(cols.join(',') + '\n');

  if (mongoDb) {
    try {
      const cursor = mongoDb.collection('detections').find({}).sort({ timeISO: -1 }).limit(limit);
      // handle client abort
      let aborted = false;
      req.on('close', () => { aborted = true; try { cursor.close(); } catch(e){} });

      cursor.stream().on('data', doc => {
        try {
          const line = cols.map(c => csvEscape(doc[c])).join(',');
          res.write(line + '\n');
        } catch (e) { /* ignore write errors per-row */ }
      }).on('end', () => {
        if (!aborted) res.end();
      }).on('error', err => {
        console.warn('cursor stream error:', err && err.message);
        if (!res.headersSent) res.status(500).end(); else res.end();
      });
      return;
    } catch (e) {
      console.warn('mongo export stream failed:', e && e.message);
      // fall through to in-memory fallback
    }
  }

  // Fallback: stream from in-memory detections array
  try {
    const rows = detections.slice(-limit);
    for (const r of rows) {
      const line = cols.map(c => csvEscape(r[c])).join(',');
      res.write(line + '\n');
    }
    res.end();
  } catch (e) {
    console.warn('export fallback failed:', e && e.message);
    try { res.end(); } catch(e){}
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🚀 CME Detector server running on http://localhost:${PORT}`));
