import { useEffect, useState } from "react";
import { Line } from "react-chartjs-2";
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";

ChartJS.register(CategoryScale, LinearScale, PointElement, LineElement, Tooltip, Legend);

const NOAA_URL = "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json";

function computeAnomalies(records) {
  const speeds = records.map(r => (r.speed == null ? NaN : Number(r.speed))).filter(v => !Number.isNaN(v));
  const dens = records.map(r => (r.density == null ? NaN : Number(r.density))).filter(v => !Number.isNaN(v));
  const mean = arr => arr.reduce((a,b)=>a+b,0)/arr.length || 0;
  const std = arr => {
    if (!arr.length) return 0;
    const m = mean(arr);
    return Math.sqrt(arr.reduce((s,v)=>s+Math.pow(v-m,2),0)/arr.length);
  };
  const sMean = mean(speeds), sStd = std(speeds);
  const dMean = mean(dens), dStd = std(dens);

  return records.map(r => {
    const v = (r.speed == null) ? NaN : Number(r.speed);
    const dv = (r.density == null) ? NaN : Number(r.density);
    const speedAnom = !Number.isNaN(v) && sStd > 0 && v > sMean + 3*sStd;
    const densAnom = !Number.isNaN(dv) && dStd > 0 && dv > dMean + 3*dStd;
    return { ...r, anomaly: (speedAnom || densAnom) ? 1 : 0 };
  });
}

export default function SolarWindChart() {
  const [records, setRecords] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchOnce = async () => {
    try {
      setError(null);
      setLoading(true);
      const res = await fetch(NOAA_URL, { cache: 'no-store' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      if (!Array.isArray(data) || data.length < 2) {
        throw new Error('unexpected NOAA response');
      }
      const header = data[0];
      const rows = data.slice(1);
      const parsed = rows.map(r => {
        const obj = {};
        for (let i = 0; i < header.length; i++) {
          obj[header[i]] = r[i];
        }
        return {
          time_tag: obj.time_tag || obj['time_tag'] || obj['date'] || null,
          speed: obj.speed ? Number(obj.speed) : (obj['speed'] ? Number(obj['speed']) : (obj['solar_wind_speed'] ? Number(obj['solar_wind_speed']) : null)),
          density: obj.density ? Number(obj.density) : (obj['density'] ? Number(obj['density']) : null),
        };
      }).filter(x => x.time_tag != null);

      const withAnoms = computeAnomalies(parsed);
      // convert time_tag to ISO string if possible
      const norm = withAnoms.map(r => ({ ...r, time_tag: (new Date(r.time_tag)).toISOString() }));
      setRecords(norm);
    } catch (e) {
      console.error(e);
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchOnce();
    const id = setInterval(fetchOnce, 60 * 1000); // poll every 60s
    return () => clearInterval(id);
  }, []);

  const labels = records.map(r => r.time_tag);
  const speed = records.map(r => r.speed);
  const anomalies = records.map(r => r.anomaly ? r.speed : null);

  const chartData = {
    labels,
    datasets: [
      {
        label: "Solar Wind Speed",
        data: speed,
        borderColor: "blue",
        tension: 0.2,
        fill: false,
      },
      {
        label: "Anomalies",
        data: anomalies,
        borderColor: "red",
        pointBackgroundColor: "red",
        showLine: false,
        pointRadius: 5,
      },
    ],
  };

  return (
    <div className="p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold">Solar Wind (NOAA real-time)</h2>
        <div className="text-sm text-gray-500">{loading ? 'loading...' : error ? `error: ${error}` : 'live (polling 60s)'}</div>
      </div>
      <Line data={chartData} />
    </div>
  );
}
