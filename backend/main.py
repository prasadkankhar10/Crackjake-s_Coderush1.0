from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
from sklearn.ensemble import IsolationForest
import numpy as np
import io
import httpx

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class DetectionResult(BaseModel):
    cme_detected: bool
    intensity: str
    eta_hours: float
    message: str
    risk_level: str
    anomaly_indices: list
    direction_estimate: str = "unknown"
    confidence: float = 0.0

class ForecastResult(BaseModel):
    eta_hours: float
    message: str

class AlertResult(BaseModel):
    risk_level: str
    message: str

# --- Helper Functions ---
def load_data(file: UploadFile):
    content = file.file.read()
    df = pd.read_csv(io.BytesIO(content))
    return df

def detect_anomaly(df):
    # Safe column checks
    for col in ['solar_wind_speed', 'particle_flux', 'solar_wind_density']:
        if col not in df.columns:
            df[col] = np.nan

    # Rolling z-scores for speed and flux
    df['z_speed'] = (df['solar_wind_speed'] - df['solar_wind_speed'].rolling(3, min_periods=1).mean()) / df['solar_wind_speed'].rolling(3, min_periods=1).std(ddof=0)
    df['z_flux'] = (df['particle_flux'] - df['particle_flux'].rolling(3, min_periods=1).mean()) / df['particle_flux'].rolling(3, min_periods=1).std(ddof=0)

    # Threshold-based anomalies
    speed_anoms = df.index[df['z_speed'].abs() > 2].tolist()
    flux_anoms = df.index[df['z_flux'].abs() > 2].tolist()

    # Isolation Forest using available numeric features
    features = df[['solar_wind_speed', 'particle_flux']].fillna(method='ffill').fillna(0).values
    clf = IsolationForest(contamination=0.1, random_state=42)
    try:
        preds = clf.fit_predict(features)
        iso_anoms = df.index[preds == -1].tolist()
    except Exception:
        iso_anoms = []

    all_anomalies = sorted(list(set(speed_anoms + flux_anoms + iso_anoms)))
    return all_anomalies


def compute_direction_and_confidence(df, anomaly_indices):
    # Default
    if not anomaly_indices:
        return "none", 0.0

    # Use indices within anomaly window
    window = df.loc[anomaly_indices]

    # Peak locations
    try:
        flux_peak_idx = int(window['particle_flux'].idxmax())
        speed_peak_idx = int(window['solar_wind_speed'].idxmax())
    except Exception:
        # fallback: use first anomaly
        flux_peak_idx = anomaly_indices[0]
        speed_peak_idx = anomaly_indices[0]

    # Heuristic: if particle flux peaks before speed -> likely earthward impact
    if flux_peak_idx < speed_peak_idx:
        direction = 'likely_earthward'
    elif flux_peak_idx == speed_peak_idx:
        direction = 'possible_earthward'
    else:
        direction = 'uncertain'

    # Confidence: based on average absolute z-scores in window
    z_speed = df.loc[anomaly_indices, 'z_speed'].abs().fillna(0)
    z_flux = df.loc[anomaly_indices, 'z_flux'].abs().fillna(0)
    mean_z = float(np.nanmean(np.concatenate([z_speed.values, z_flux.values]))) if len(z_speed) + len(z_flux) > 0 else 0.0
    # normalize: assume mean_z of 4+ is high confidence
    confidence = min(1.0, mean_z / 4.0)
    return direction, round(confidence, 2)

def classify_intensity(df, anomaly_indices):
    if not anomaly_indices:
        return "none"
    max_speed = df.loc[anomaly_indices, 'solar_wind_speed'].max()
    if max_speed > 600:
        return "severe"
    elif max_speed > 450:
        return "medium"
    else:
        return "mild"

def estimate_eta(df, anomaly_indices):
    # Assume CME starts at first anomaly
    if not anomaly_indices:
        return None
    idx = anomaly_indices[0]
    speed = df.loc[idx, 'solar_wind_speed']
    # 1 AU = 149597870.7 km, ETA (hours) = distance / speed (km/s) / 3600
    eta = 149597870.7 / (speed * 1000) / 3600
    return round(eta, 2)

def risk_level_and_message(intensity):
    if intensity == "severe":
        return "red", "Strong CME detected! High risk to satellites and power grids. Take immediate action."
    elif intensity == "medium":
        return "yellow", "Moderate CME detected. Monitor systems and prepare for possible impact."
    elif intensity == "mild":
        return "yellow", "Mild CME detected. Low risk, but monitor for updates."
    else:
        return "green", "No CME detected. All clear."

# --- Endpoints ---
@app.post("/detect", response_model=DetectionResult)
async def detect(file: UploadFile = File(...)):
    df = load_data(file)
    anomaly_indices = detect_anomaly(df)
    intensity = classify_intensity(df, anomaly_indices)
    eta = estimate_eta(df, anomaly_indices)
    direction, confidence = compute_direction_and_confidence(df, anomaly_indices)
    risk, msg = risk_level_and_message(intensity)
    return DetectionResult(
        cme_detected=bool(anomaly_indices),
        intensity=intensity,
        eta_hours=eta if eta else 0.0,
        message=msg,
        risk_level=risk,
        anomaly_indices=anomaly_indices,
        direction_estimate=direction,
        confidence=confidence
    )

@app.post("/forecast", response_model=ForecastResult)
async def forecast(file: UploadFile = File(...)):
    df = load_data(file)
    anomaly_indices = detect_anomaly(df)
    eta = estimate_eta(df, anomaly_indices)
    if eta:
        msg = f"Estimated CME impact at Earth in {eta} hours."
    else:
        msg = "No CME detected."
    return ForecastResult(eta_hours=eta if eta else 0.0, message=msg)

@app.get("/alerts", response_model=AlertResult)
async def alerts():
    # For demo, always return green
    return AlertResult(risk_level="green", message="No CME detected. All clear.")

@app.get("/external/cactus")
async def cactus():
    # Example: fetch from CACTus API (mocked)
    async with httpx.AsyncClient() as client:
        # Replace with real endpoint if available
        resp = await client.get("https://api.mock.cactus/cme/latest")
        return resp.json()

@app.get("/external/donki")
async def donki():
    # Example: fetch from NASA DONKI API (mocked)
    async with httpx.AsyncClient() as client:
        resp = await client.get("https://api.nasa.gov/DONKI/CME?api_key=DEMO_KEY")
        return resp.json()
