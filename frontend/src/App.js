import React, { useState } from "react";
import axios from "axios";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";

const API = "http://localhost:8000";

const riskColors = {
  green: "bg-green-500",
  yellow: "bg-yellow-400",
  red: "bg-red-500",
};

function App() {
  const [file, setFile] = useState(null);
  const [data, setData] = useState([]);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);

  const handleFile = (e) => {
    setFile(e.target.files[0]);
  };

  const handleUpload = async () => {
    if (!file) return;
    setLoading(true);
    const formData = new FormData();
    formData.append("file", file);
    try {
      const res = await axios.post(`${API}/detect`, formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setResult(res.data);
      // Parse CSV for chart
      const text = await file.text();
      const rows = text.trim().split("\n");
      const keys = rows[0].split(",");
      const chartData = rows.slice(1).map((row) => {
        const vals = row.split(",");
        let obj = {};
        keys.forEach((k, i) => (obj[k] = isNaN(vals[i]) ? vals[i] : +vals[i]));
        return obj;
      });
      setData(chartData);
    } catch (e) {
      alert("Error: " + e.message);
    }
    setLoading(false);
  };

  return (
    <div className="max-w-3xl mx-auto p-4">
      <h1 className="text-2xl font-bold mb-4">Aditya-L1 CME Detection MVP</h1>
      <div className="mb-4 flex items-center gap-2">
        <input type="file" accept=".csv" onChange={handleFile} className="border p-2" />
        <button onClick={handleUpload} disabled={loading || !file} className="bg-blue-600 text-white px-4 py-2 rounded disabled:opacity-50">
          {loading ? "Processing..." : "Upload & Detect"}
        </button>
      </div>
      {result && (
        <div className={`p-3 rounded mb-4 text-white ${riskColors[result.risk_level]}`}>Risk: <b>{result.risk_level.toUpperCase()}</b> — {result.message}</div>
      )}
      {data.length > 0 && (
        <div className="bg-white rounded shadow p-4 mb-4">
          <h2 className="font-semibold mb-2">Solar Wind & Flux</h2>
          <ResponsiveContainer width="100%" height={250}>
            <LineChart data={data}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="timestamp" tick={{ fontSize: 10 }} />
              <YAxis yAxisId="left" label={{ value: "Speed (km/s)", angle: -90, position: "insideLeft" }} />
              <YAxis yAxisId="right" orientation="right" label={{ value: "Flux", angle: 90, position: "insideRight" }} />
              <Tooltip />
              <Legend />
              <Line yAxisId="left" type="monotone" dataKey="solar_wind_speed" stroke="#2563eb" name="Wind Speed" />
              <Line yAxisId="right" type="monotone" dataKey="particle_flux" stroke="#f59e42" name="Particle Flux" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}
      {result && (
        <div className="bg-gray-100 rounded p-4 flex flex-col gap-2">
          <div><b>CME Detected:</b> {result.cme_detected ? "Yes" : "No"}</div>
          <div><b>Intensity:</b> {result.intensity}</div>
          <div><b>Estimated Earth Impact ETA:</b> {result.eta_hours} hours</div>
          <div><b>Anomaly Indices:</b> {result.anomaly_indices.join(", ")}</div>
        </div>
      )}
      <footer className="mt-8 text-xs text-gray-400 text-center">Hackathon MVP &copy; 2025</footer>
    </div>
  );
}

export default App;
