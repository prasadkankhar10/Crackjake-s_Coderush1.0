"""Scan local SUIT FITS files under data/ and report any that the pipeline
classifies with intensity 'severe'.

Usage (run from repo root):
    python backend/check_fits_for_cme.py

This script does NOT start the webserver. It uses the same ingest and detection
helpers as the FastAPI app.
"""
from pathlib import Path
import pandas as pd
from ingest_suit import process_fits_file
# import helpers from main (detection functions)
from main import detect_anomaly, classify_intensity


def scan_folder(data_dir: Path):
    fits_paths = sorted([p for p in data_dir.rglob('*.fits')])
    if not fits_paths:
        print(f"No .fits files found under {data_dir}")
        return

    rows = []
    for p in fits_paths:
        info = process_fits_file(p)
        if not info:
            continue
        rows.append({
            'file': p.name,
            'path': str(p),
            'timestamp': info.get('timestamp'),
            'solar_irradiance': info.get('solar_irradiance')
        })

    if not rows:
        print("No valid FITS data parsed.")
        return

    df = pd.DataFrame(rows)

    # For detection we need columns expected by the detector; fill missing with NaN
    det_df = pd.DataFrame({
        'timestamp': df['timestamp'],
        'solar_irradiance': df['solar_irradiance'],
        'solar_wind_speed': pd.NA,
        'solar_wind_density': pd.NA,
        'particle_flux': pd.NA
    })

    anomalies = detect_anomaly(det_df)
    intensity = classify_intensity(det_df, anomalies)

    # Report results
    print(f"Scanned {len(df)} FITS files.")
    print(f"Detected anomaly indices: {anomalies}")
    print(f"Classified intensity: {intensity}")
    if intensity == 'severe':
        print("Strong CME detected based on ingestion heuristics!")
        print(df.to_string(index=False))
    else:
        print("No strong CME found in scanned FITS files.")


if __name__ == '__main__':
    repo_root = Path(__file__).resolve().parent.parent
    data_dir = repo_root / 'data'
    scan_folder(data_dir)
