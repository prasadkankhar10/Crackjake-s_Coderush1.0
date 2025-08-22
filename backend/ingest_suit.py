"""
Simple SUIT FITS ingestion helper
- Scans a folder of SUIT FITS files
- Extracts timestamp from FITS header (common keywords: DATE-OBS or DATE_OBS)
- Computes a simple irradiance/flux proxy per image (mean or median of image pixels)
- Writes CSV with columns: timestamp,solar_irradiance,particle_flux,solar_wind_speed,solar_wind_density
  (we only fill solar_irradiance and leave others blank for downstream pipeline)

Usage:
    python ingest_suit.py --dir "../data/suit_2025Aug22T041648755" --out ../data/suit_converted.csv

Install:
    pip install astropy pandas

Notes:
- FITS headers vary; the script tries several common header keywords for observation time.
- The irradiance value here is a simple proxy (mean pixel value scaled by EXPTIME if present).
- For more accurate radiometric calibration, apply instrument calibration coefficients (not included).
"""

from pathlib import Path
import argparse
import pandas as pd
import numpy as np

try:
    from astropy.io import fits
except Exception:
    raise SystemExit("astropy is required: pip install astropy")


def extract_time_hdr(hdr):
    # common FITS time keywords used by many instruments
    for key in ("DATE-OBS", "DATE_OBS", "DATE", "TIME-OBS", "TIME_OBS", "DATE-OBS-ISO"):
        if key in hdr:
            return hdr[key]
    # try observation start/stop
    for key in ("OBS-DATE", "MJD-OBS", "MJD"):  # MJD needs conversion
        if key in hdr:
            return hdr[key]
    return None


def process_fits_file(p: Path):
    try:
        with fits.open(p, memmap=False) as h:
            hdr = h[0].header
            data = None
            # try typical HDU locations for image
            for hdu in h:
                if hasattr(hdu, 'data') and hdu.data is not None:
                    data = hdu.data
                    break
            if data is None:
                return None
            # compute proxy metrics
            # convert to float
            arr = np.asarray(data, dtype=float)
            # mask NaNs/infs
            arr = arr[np.isfinite(arr)]
            if arr.size == 0:
                mean_val = float('nan')
                median_val = float('nan')
            else:
                mean_val = float(np.mean(arr))
                median_val = float(np.median(arr))
            exptime = hdr.get('EXPTIME') or hdr.get('EXPOSURE') or hdr.get('EXPOS')
            if exptime:
                try:
                    exptime = float(exptime)
                except Exception:
                    exptime = None
            # scale proxy by exposure if available
            irradiance_proxy = mean_val * exptime if exptime else mean_val
            timestamp = extract_time_hdr(hdr)
            return {
                'file': str(p.name),
                'timestamp': timestamp,
                'mean_pixel': mean_val,
                'median_pixel': median_val,
                'exposure': exptime,
                'solar_irradiance': irradiance_proxy
            }
    except Exception as e:
        print(f"Failed to read {p}: {e}")
        return None


def folder_to_csv(folder: Path, out_csv: Path):
    files = sorted([p for p in folder.iterdir() if p.suffix.lower() in ('.fits', '.fit', '.fts')])
    rows = []
    for p in files:
        info = process_fits_file(p)
        if info:
            rows.append(info)
    if not rows:
        raise SystemExit("No valid FITS data found in folder")
    df = pd.DataFrame(rows)
    # normalize timestamp column to ISO if possible
    try:
        df['timestamp'] = pd.to_datetime(df['timestamp'], errors='coerce')
        df = df.dropna(subset=['timestamp']).reset_index(drop=True)
        df['timestamp'] = df['timestamp'].dt.strftime('%Y-%m-%dT%H:%M:%SZ')
    except Exception:
        pass
    # create final columns expected by detector
    out = pd.DataFrame()
    out['timestamp'] = df['timestamp']
    out['solar_irradiance'] = df['solar_irradiance']
    # placeholders for other columns (left empty)
    out['solar_wind_speed'] = pd.NA
    out['solar_wind_density'] = pd.NA
    out['particle_flux'] = pd.NA
    out.to_csv(out_csv, index=False)
    print(f"Wrote {len(out)} rows to {out_csv}")


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--dir', required=True, help='Folder containing SUIT FITS files')
    parser.add_argument('--out', required=True, help='Output CSV path')
    args = parser.parse_args()
    folder = Path(args.dir)
    out = Path(args.out)
    folder_to_csv(folder, out)
