import React, { useState } from "react";
import axios from "axios";
import SolarWindChart from './components/SolarWindChart';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const API = "http://localhost:8000";

const riskStyles = {
  green: { bg: "bg-green-600/90", text: "text-green-900" },
  yellow: { bg: "bg-yellow-400/90", text: "text-yellow-900" },
  red: { bg: "bg-red-600/90", text: "text-red-50" },
};

function Spinner({ size = 5 }) {
  return <div className={`animate-spin rounded-full h-${size} w-${size} border-t-2 border-b-2 border-gray-200`} />;
}

function Badge({ children, color = "bg-gray-200" }) {
  return <span className={`inline-block px-2 py-1 text-xs font-medium rounded ${color}`}>{children}</span>;
}

function KeyValueTable({ obj }) {
  if (!obj) return null;
  return (
    <div className="grid grid-cols-2 gap-2">
      {Object.entries(obj).map(([k, v]) => (
        <div key={k} className="flex gap-2 items-start">
          <div className="text-xs text-gray-500 w-32">{k}</div>
          <div className="text-sm break-all">{String(v)}</div>
        </div>
      ))}
    </div>
  );
}

export default function App() {
  const [file, setFile] = useState(null);
  const [data, setData] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [suitFolder, setSuitFolder] = useState("suit_2025Aug22T041648755");
  const [suitZip, setSuitZip] = useState(null);
  const [suitFits, setSuitFits] = useState(null);

  // bundled sample CSVs so the UI can load and run detection without external hosting
  const sampleCSVs = {
    "sample_ok_small": `timestamp,solar_irradiance,DATE-OBS,OBS_MODE,IMGNUM,FTR_NAME,ROI_FF,ROI_ID,IMG_TYPE,CMD_EXPT,CRPIX1,CRPIX2,RSUN_OBS,DSUN_OBS,HGLT_OBS,HGLN_OBS,P_ANGLE,ROLL
2025-08-22T00:00:00Z,118,2025-08-22T00:00:00Z,NORMAL,1,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T01:00:00Z,119,2025-08-22T01:00:00Z,NORMAL,2,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T02:00:00Z,120,2025-08-22T02:00:00Z,NORMAL,3,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T03:00:00Z,121,2025-08-22T03:00:00Z,NORMAL,4,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T04:00:00Z,122,2025-08-22T04:00:00Z,NORMAL,5,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
`,
    "sample_highrisk_spike": `timestamp,solar_irradiance,DATE-OBS,OBS_MODE,IMGNUM,FTR_NAME,ROI_FF,ROI_ID,IMG_TYPE,CMD_EXPT,CRPIX1,CRPIX2,RSUN_OBS,DSUN_OBS,HGLT_OBS,HGLN_OBS,P_ANGLE,ROLL
2025-08-22T00:00:00Z,120,2025-08-22T00:00:00Z,NORMAL,1,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T01:00:00Z,122,2025-08-22T01:00:00Z,NORMAL,2,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T02:00:00Z,125,2025-08-22T02:00:00Z,NORMAL,3,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T03:00:00Z,130,2025-08-22T03:00:00Z,NORMAL,4,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T04:00:00Z,900,2025-08-22T04:00:00Z,EVENT,5,SUT_T25,0.9,1,SCI,100,512,512,695700,149600000,60,0.0,0.0,0.0
2025-08-22T05:00:00Z,1200,2025-08-22T05:00:00Z,EVENT,6,SUT_T25,1.0,1,SCI,120,512,512,695700,149600000,60,0.0,0.0,0.0
2025-08-22T06:00:00Z,128,2025-08-22T06:00:00Z,NORMAL,7,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
`,
    "sample_highrisk_extended": `timestamp,solar_irradiance,DATE-OBS,OBS_MODE,IMGNUM,FTR_NAME,ROI_FF,ROI_ID,IMG_TYPE,CMD_EXPT,CRPIX1,CRPIX2,RSUN_OBS,DSUN_OBS,HGLT_OBS,HGLN_OBS,P_ANGLE,ROLL
2025-08-22T00:00:00Z,130,2025-08-22T00:00:00Z,NORMAL,1,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T01:00:00Z,135,2025-08-22T01:00:00Z,NORMAL,2,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T02:00:00Z,140,2025-08-22T02:00:00Z,NORMAL,3,SUT_T25,0.1,1,SCI,10,512,512,695700,149600000,0.0,0.0,0.0,0.0
2025-08-22T03:00:00Z,450,2025-08-22T03:00:00Z,EVENT,4,SUT_T25,0.6,1,SCI,60,512,512,695700,149600000,45,0.0,0.0,0.0
2025-08-22T04:00:00Z,500,2025-08-22T04:00:00Z,EVENT,5,SUT_T25,0.7,1,SCI,80,512,512,695700,149600000,45,0.0,0.0,0.0
2025-08-22T05:00:00Z,550,2025-08-22T05:00:00Z,EVENT,6,SUT_T25,0.8,1,SCI,90,512,512,695700,149600000,45,0.0,0.0,0.0
2025-08-22T06:00:00Z,520,2025-08-22T06:00:00Z,EVENT,7,SUT_T25,0.7,1,SCI,80,512,512,695700,149600000,45,0.0,0.0,0.0,0.0
`,
  };

  const loadSampleAndDetect = async (key) => {
    const csv = sampleCSVs[key];
    if (!csv) return;
    const f = new File([csv], `${key}.csv`, { type: 'text/csv' });
    setFile(f);
    // slight delay to ensure state updates before upload
    setTimeout(() => handleUpload(), 50);
  };

  const parseCsvToChart = async (fileObj) => {
    try {
      const text = await fileObj.text();
      const rows = text.trim().split("\n");
      if (rows.length < 2) return [];
      const keys = rows[0].split(",").map((k) => k.trim());
      const chartData = rows.slice(1).map((row) => {
        const vals = row.split(",");
        let obj = {};
        keys.forEach((k, i) => {
          const raw = vals[i] === undefined ? "" : vals[i].trim();
          obj[k] = raw === "" ? null : isNaN(raw) ? raw : +raw;
        });
        return obj;
      });
      return chartData;
    } catch (e) {
      return [];
    }
  };

  function localDetect(chartData) {
    // simple statistical detector based on solar_irradiance
    const vals = chartData.map((r) => (typeof r.solar_irradiance === 'number' ? r.solar_irradiance : parseFloat(r.solar_irradiance))).filter(v => !Number.isNaN(v));
    if (vals.length === 0) {
      return {
        cme_detected: false,
        risk_level: 'green',
        message: 'No CME detected. All clear.',
        eta_hours: 0,
        intensity: 'none',
        anomaly_indices: [],
        direction_estimate: 'none',
        confidence: 0,
      };
    }
    const mean = vals.reduce((a,b)=>a+b,0)/vals.length;
    const variance = vals.reduce((a,b)=>a+Math.pow(b-mean,2),0)/vals.length;
    const std = Math.sqrt(variance);
    const max = Math.max(...vals);
    const anomaly_indices = [];
    chartData.forEach((r,i)=>{
      const v = (typeof r.solar_irradiance === 'number' ? r.solar_irradiance : parseFloat(r.solar_irradiance));
      if (!Number.isNaN(v) && v > mean + 3*std) anomaly_indices.push(i);
    });

    let intensity = 'none';
    if (max > 800) intensity = 'severe';
    else if (max > 500) intensity = 'medium';
    else if (max > 300) intensity = 'mild';

    const cme_detected = anomaly_indices.length > 0 && intensity !== 'none';

    let risk_level = 'green';
    if (cme_detected) {
      if (intensity === 'severe') risk_level = 'red';
      else risk_level = 'yellow';
    }

    let eta_hours = 0;
    if (cme_detected) {
      if (intensity === 'severe') eta_hours = 12;
      else if (intensity === 'medium') eta_hours = 24;
      else eta_hours = 48;
    }

    const confidence = cme_detected ? Math.min(1, (max - mean) / (max || 1)) : 0;

    const direction_estimate = cme_detected ? 'possible_earthward' : 'none';

    const message = cme_detected ? `Strong CME detected (${intensity})` : 'No CME detected. All clear.';

    return {
      cme_detected,
      risk_level,
      message,
      eta_hours,
      intensity,
      anomaly_indices,
      direction_estimate,
      confidence,
    };
  }

  const expectedHeaders = [
    "timestamp","solar_irradiance","DATE-OBS","OBS_MODE","IMGNUM","FTR_NAME","ROI_FF","ROI_ID","IMG_TYPE","CMD_EXPT","CRPIX1","CRPIX2","RSUN_OBS","DSUN_OBS","HGLT_OBS","HGLN_OBS","P_ANGLE","ROLL"
  ];

  const validateHeaders = (keys) => {
    if (!Array.isArray(keys)) return false;
    if (keys.length !== expectedHeaders.length) return false;
    for (let i = 0; i < expectedHeaders.length; i++) {
      if ((keys[i] || "").trim() !== expectedHeaders[i]) return false;
    }
    return true;
  };

  const handleFile = (e) => setFile(e.target.files[0] || null);
  const handleSuitZip = (e) => setSuitZip(e.target.files[0] || null);
  const handleSuitFits = (e) => setSuitFits(e.target.files[0] || null);

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    try {
      const chartData = await parseCsvToChart(file);
      if (!chartData || chartData.length === 0) {
        alert("Could not parse CSV — ensure it is a valid CSV with headers and rows.");
        setLoading(false);
        return;
      }
      const fileKeys = Object.keys(chartData[0]);
      if (!validateHeaders(fileKeys)) {
        alert("CSV header mismatch. Expected:\n" + expectedHeaders.join(","));
        setLoading(false);
        return;
      }

      // run local detection math and update UI
      const local = localDetect(chartData);
      setResult(local);
      setData(chartData);
    } catch (e) {
      console.error(e);
      alert("Error: " + (e.response?.data?.error || e.message));
    } finally {
      setLoading(false);
    }
  };

  const runSuitFolder = async () => {
    setLoading(true);
    try {
      const res = await axios.post(`${API}/detect_suit_folder?folder=${encodeURIComponent(suitFolder)}`);
      setResult(res.data);
      setData([]);
    } catch (e) {
      alert("Error: " + (e.response?.data?.error || e.message));
    } finally { setLoading(false); }
  };

  const uploadSuitZip = async () => {
    if (!suitZip) return alert("Choose a zip file first");
    setLoading(true);
    const fd = new FormData();
    fd.append("file", suitZip);
    try {
      const res = await axios.post(`${API}/detect_suit_upload`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(res.data);
      setData([]);
    } catch (e) {
      alert("Error: " + (e.response?.data?.error || e.message));
    } finally { setLoading(false); }
  };

  const uploadSuitFits = async () => {
    if (!suitFits) return alert("Choose a FITS file first");
    setLoading(true);
    const fd = new FormData();
    fd.append("file", suitFits);
    try {
      const res = await axios.post(`${API}/detect_suit_file`, fd, { headers: { "Content-Type": "multipart/form-data" } });
      setResult(res.data);
      setData([]);
    } catch (e) {
      alert("Error: " + (e.response?.data?.error || e.message));
    } finally { setLoading(false); }
  };

  const risk = result?.risk_level || "green";

  return (
    <div className="min-h-screen bg-slate-50 py-8 px-4">
      <div className="max-w-5xl mx-auto">
        <header className="flex items-center justify-between mb-6">
          <div>
            <h1 className="text-2xl font-bold">Aditya-L1 CME Detection</h1>
            <p className="text-sm text-gray-600">Upload SUIT data (CSV / ZIP / FITS) and get quick CME detection & metadata.</p>
          </div>
          <div className="text-sm text-gray-500">MVP • 2025</div>
        </header>

        <main className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <section className="md:col-span-2 space-y-4">
            <div className="bg-white rounded-lg shadow p-4">
              <div className="flex items-center justify-between">
                <h2 className="font-semibold">Upload CSV for Detection</h2>
                <div className="flex items-center gap-3">
                  {loading && <div className="flex items-center gap-2"><Spinner size={5} /><span className="text-xs text-gray-500">Processing</span></div>}
                </div>
              </div>

              <div className="mt-3 flex flex-col sm:flex-row gap-3">
                <label className="flex-1 border-dashed border-2 border-gray-200 rounded p-3 bg-gray-50 hover:border-gray-300 cursor-pointer">
                  <div className="text-sm text-gray-600">Select CSV file</div>
                  <div className="text-xs text-gray-400 mt-1">Time series with timestamp, solar_wind_speed, particle_flux, etc.</div>
                  <input type="file" accept=".csv" onChange={handleFile} className="hidden" />
                  <div className="mt-2 text-sm text-gray-700">{file ? file.name : "No file chosen"}</div>
                </label>

                <div className="flex flex-col sm:flex-row items-start gap-2">
                  <button onClick={handleUpload} disabled={!file || loading} className="px-4 py-2 bg-blue-600 text-white rounded disabled:opacity-60">Upload & Detect</button>
                  <div className="flex gap-2">
                    <button onClick={() => loadSampleAndDetect('sample_ok_small')} className="px-3 py-1 bg-gray-100 rounded text-sm">Demo OK</button>
                    <button onClick={() => loadSampleAndDetect('sample_highrisk_spike')} className="px-3 py-1 bg-red-100 rounded text-sm">Demo Spike</button>
                    <button onClick={() => loadSampleAndDetect('sample_highrisk_extended')} className="px-3 py-1 bg-red-200 rounded text-sm">Demo Extended</button>
                  </div>
                </div>
              </div>
            </div>

            <SolarWindChart />

            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-medium mb-2">Visualization</h3>
              {data.length > 0 ? (
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="left" label={{ value: "Irradiance", angle: -90, position: "insideLeft" }} />
                    <YAxis yAxisId="right" orientation="right" label={{ value: "Flux", angle: 90, position: "insideRight" }} />
                    <Tooltip />
                    <Legend />
                    <Line yAxisId="left" type="monotone" dataKey="solar_irradiance" stroke="#2563eb" name="Irradiance" />
                    <Line yAxisId="right" type="monotone" dataKey="particle_flux" stroke="#f59e42" name="Particle Flux" />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="text-sm text-gray-400">Upload a CSV to see charts here.</div>
              )}
            </div>
          </section>

          <aside className="space-y-4">
            <div className="bg-white rounded-lg shadow p-4">
              <h3 className="font-medium">SUIT Folder / ZIP / FITS</h3>
              <div className="mt-3 space-y-3">
                <div className="flex gap-2">
                  <input value={suitFolder} onChange={(e) => setSuitFolder(e.target.value)} className="flex-1 border rounded px-2 py-1" />
                  <button onClick={runSuitFolder} className="px-3 py-1 bg-indigo-600 text-white rounded">Run</button>
                </div>

                <div className="border-t pt-3">
                  <label className="flex items-center gap-2">
                    <input type="file" accept=".zip" onChange={handleSuitZip} className="hidden" />
                    <button onClick={() => document.querySelector('input[type=file][accept=".zip"]').click()} className="px-3 py-1 bg-teal-600 text-white rounded">Choose ZIP</button>
                    <div className="text-sm text-gray-500">{suitZip ? suitZip.name : "No zip chosen"}</div>
                  </label>
                  <div className="mt-2">
                    <button onClick={uploadSuitZip} className="px-3 py-1 bg-teal-700 text-white rounded">Upload & Detect</button>
                  </div>
                </div>

                <div className="border-t pt-3">
                  <label className="flex items-center gap-2">
                    <input type="file" accept=".fits,.fit,.fts" onChange={handleSuitFits} className="hidden" />
                    <button onClick={() => document.querySelector('input[type=file][accept=".fits,.fit,.fts"]').click()} className="px-3 py-1 bg-purple-600 text-white rounded">Choose FITS</button>
                    <div className="text-sm text-gray-500 break-all">{suitFits ? suitFits.name : "No FITS chosen"}</div>
                  </label>
                  <div className="mt-2">
                    <button onClick={uploadSuitFits} className="px-3 py-1 bg-purple-700 text-white rounded">Upload FITS & Detect</button>
                  </div>
                </div>
              </div>
            </div>

            
          </aside>
        </main>

        <footer className="mt-8 text-center text-xs text-gray-400">Hackathon MVP • &copy; 2025</footer>
      </div>
    </div>
  );
}
