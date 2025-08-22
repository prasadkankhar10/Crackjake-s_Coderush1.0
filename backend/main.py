from fastapi import FastAPI, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import pandas as pd
from sklearn.ensemble import IsolationForest
import numpy as np
import io
import httpx
import requests
from pathlib import Path

from ingest_suit import folder_to_csv, process_fits_file
try:
    from astropy.io import fits as _fits
except Exception:
    _fits = None
import tempfile
import zipfile
import shutil
import os

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

NOAA_URL = "https://services.swpc.noaa.gov/products/solar-wind/plasma-1-day.json"


@app.get("/data")
def get_data():
    # NOAA API gives JSON, not CSV
    r = requests.get(NOAA_URL)
    data = r.json()

    # Convert to DataFrame (skip header row)
    df = pd.DataFrame(data[1:], columns=data[0])
    # parse timestamp and numeric columns
    if 'time_tag' in df.columns:
        df["time_tag"] = pd.to_datetime(df["time_tag"], errors='coerce')
    # NOAA fields names can vary; map to density/speed if present
    if 'density' in df.columns:
        df["density"] = pd.to_numeric(df["density"], errors="coerce")
    if 'speed' in df.columns:
        df["speed"] = pd.to_numeric(df["speed"], errors="coerce")

    # Drop NaNs
    if 'density' in df.columns and 'speed' in df.columns:
        df = df.dropna(subset=["density", "speed"])

    # Anomaly detection (if numeric data present)
    if 'density' in df.columns and 'speed' in df.columns and len(df) > 0:
        features = df[["density", "speed"]]
        model = IsolationForest(contamination=0.02, random_state=42)
        try:
            df["anomaly"] = model.fit_predict(features)
            df["anomaly"] = df["anomaly"].apply(lambda x: 1 if x == -1 else 0)
        except Exception:
            df["anomaly"] = 0
    else:
        df["anomaly"] = 0

    # Return records (convert timestamps to ISO strings)
    out = df.to_dict(orient="records")
    for r in out:
        if isinstance(r.get('time_tag'), (pd.Timestamp,)):
            r['time_tag'] = r['time_tag'].isoformat()
    return out

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


@app.post("/detect_suit_folder")
async def detect_suit_folder(folder: str):
    """Server-side: convert a SUIT FITS folder (inside data/) to CSV and run detection.
    Provide `folder` as a relative path inside the repo `data/` folder, for example:
    /detect_suit_folder?folder=suit_2025Aug22T041648755
    """
    base = Path(__file__).resolve().parent.parent
    data_dir = base / "data"
    # resolve folder path - prefer relative under data/
    folder_path = Path(folder)
    if not folder_path.is_absolute():
        folder_path = data_dir / folder_path
    try:
        folder_path = folder_path.resolve()
        # safety: ensure folder is under data_dir
        if not str(folder_path).startswith(str(data_dir.resolve())):
            return {"error": "folder must be inside data/ directory"}
        if not folder_path.exists() or not folder_path.is_dir():
            return {"error": f"folder not found: {folder_path}"}
    except Exception as e:
        return {"error": str(e)}

    out_csv = data_dir / f"suit_converted_{folder_path.name}.csv"
    try:
        folder_to_csv(folder_path, out_csv)
    except Exception as e:
        return {"error": f"ingest failed: {e}"}

    # read CSV and run existing detection pipeline
    try:
        df = pd.read_csv(out_csv)
    except Exception as e:
        return {"error": f"failed to read converted CSV: {e}"}

    anomaly_indices = detect_anomaly(df)
    intensity = classify_intensity(df, anomaly_indices)
    eta = estimate_eta(df, anomaly_indices)
    direction, confidence = compute_direction_and_confidence(df, anomaly_indices)
    risk, msg = risk_level_and_message(intensity)

    return {
        "cme_detected": bool(anomaly_indices),
        "intensity": intensity,
        "eta_hours": eta if eta else 0.0,
        "message": msg,
        "risk_level": risk,
        "anomaly_indices": anomaly_indices,
        "direction_estimate": direction,
        "confidence": confidence,
        "rows": len(df),
        "csv": str(out_csv)
    }


@app.post('/detect_suit_upload')
async def detect_suit_upload(file: UploadFile = File(...)):
    """Accept a ZIP file upload containing SUIT FITS files. Extract, run ingest, detect, and return results."""
    # validate content type (basic)
    if not (file.filename.lower().endswith('.zip') or file.content_type == 'application/zip'):
        return {"error": "please upload a .zip file containing FITS files"}

    tmpdir = Path(tempfile.mkdtemp(prefix='suit_upload_'))
    try:
        data = await file.read()
        zip_path = tmpdir / file.filename
        zip_path.write_bytes(data)
        # extract
        try:
            with zipfile.ZipFile(zip_path, 'r') as z:
                z.extractall(tmpdir)
        except zipfile.BadZipFile:
            return {"error": "invalid zip file"}

        # find folder with FITS files (or use tmpdir)
        fits_folder = None
        for root, dirs, files in os.walk(tmpdir):
            for f in files:
                if f.lower().endswith(('.fits', '.fit', '.fts')):
                    fits_folder = Path(root)
                    break
            if fits_folder:
                break
        if not fits_folder:
            return {"error": "no FITS files found in uploaded zip"}

        out_csv = tmpdir / f"suit_converted_upload.csv"
        folder_to_csv(fits_folder, out_csv)

        df = pd.read_csv(out_csv)
        anomaly_indices = detect_anomaly(df)
        intensity = classify_intensity(df, anomaly_indices)
        eta = estimate_eta(df, anomaly_indices)
        direction, confidence = compute_direction_and_confidence(df, anomaly_indices)
        risk, msg = risk_level_and_message(intensity)

        return {
            "cme_detected": bool(anomaly_indices),
            "intensity": intensity,
            "eta_hours": eta if eta else 0.0,
            "message": msg,
            "risk_level": risk,
            "anomaly_indices": anomaly_indices,
            "direction_estimate": direction,
            "confidence": confidence,
            "rows": len(df),
            "csv": str(out_csv)
        }
    finally:
        # cleanup
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass


@app.post('/detect_suit_file')
async def detect_suit_file(file: UploadFile = File(...)):
    """Accept a single FITS file upload and run ingestion+detect on it."""
    if not file.filename.lower().endswith(('.fits', '.fit', '.fts')):
        return {"error": "please upload a FITS file (extension .fits/.fit/.fts)"}

    tmpdir = Path(tempfile.mkdtemp(prefix='suit_file_'))
    try:
        data = await file.read()
        fitspath = tmpdir / file.filename
        fitspath.write_bytes(data)
        # extract header metadata using user's workflow
        useful_keys = [
            "DATE-OBS", "OBS_MODE", "IMGNUM",
            "FTR_NAME", "ROI_FF", "ROI_ID", "IMG_TYPE", "CMD_EXPT",
            "SOLX1TR", "SOLX2TR", "HELIOSTR", "FLR_TRIG", "NRMFLG", "PRMFLG", "SX1FLG", "SX2FLG", "HL1OSFLG",
            "CRPIX1", "CRPIX2", "RSUN_OBS", "DSUN_OBS", "HGLT_OBS", "HGLN_OBS", "P_ANGLE", "ROLL"
        ]

        metadata = {}
        if _fits is None:
            return {"error": "astropy is required on the server to read FITS headers"}
        try:
            with _fits.open(fitspath) as fh:
                hdr = dict(fh[0].header)
        except Exception as e:
            return {"error": f"failed to read FITS header: {e}"}

        for k in useful_keys:
            metadata[k] = hdr.get(k, None)
        metadata['file'] = fitspath.name
        metadata['path'] = str(fitspath)

        # write metadata CSV
        meta_csv = tmpdir / f"{fitspath.stem}_metadata.csv"
        try:
            pd.DataFrame([metadata]).to_csv(meta_csv, index=False)
        except Exception as e:
            return {"error": f"failed to write metadata CSV: {e}"}

        # compute irradiance proxy from image data (reuse existing helper)
        info = process_fits_file(fitspath)
        if not info:
            return {"error": "failed to parse FITS file image data"}

        # construct detection-compatible CSV (single-row)
        det_row = {
            'timestamp': info.get('timestamp') or metadata.get('DATE-OBS'),
            'solar_irradiance': info.get('solar_irradiance'),
            'solar_wind_speed': pd.NA,
            'solar_wind_density': pd.NA,
            'particle_flux': pd.NA
        }
        det_df = pd.DataFrame([det_row])
        det_csv = tmpdir / f"{fitspath.stem}_converted.csv"
        det_df.to_csv(det_csv, index=False)

        anomaly_indices = detect_anomaly(det_df)
        intensity = classify_intensity(det_df, anomaly_indices)
        eta = estimate_eta(det_df, anomaly_indices)
        direction, confidence = compute_direction_and_confidence(det_df, anomaly_indices)
        risk, msg = risk_level_and_message(intensity)

        return {
            "cme_detected": bool(anomaly_indices),
            "intensity": intensity,
            "eta_hours": eta if eta else 0.0,
            "message": msg,
            "risk_level": risk,
            "anomaly_indices": anomaly_indices,
            "direction_estimate": direction,
            "confidence": confidence,
            "rows": len(det_df),
            "metadata_csv": str(meta_csv),
            "detection_csv": str(det_csv),
            "metadata": metadata
        }
    finally:
        try:
            shutil.rmtree(tmpdir)
        except Exception:
            pass
