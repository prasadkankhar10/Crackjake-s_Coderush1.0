"""Extract selected FITS header keywords from a folder of FITS files and save to CSV.

Usage:
    python extract_fits_headers.py --dir ../data/suit_2025Aug22T041648755 --out ../data/suit_metadata.csv

This follows the workflow provided by the user: read header keys with astropy and
write them into a CSV (one row per FITS file).
"""
from pathlib import Path
import argparse
import pandas as pd

try:
    from astropy.io import fits
except Exception:
    raise SystemExit("astropy is required: pip install astropy")


useful_keys = [
    "DATE-OBS", "OBS_MODE", "IMGNUM",
    "FTR_NAME", "ROI_FF", "ROI_ID", "IMG_TYPE", "CMD_EXPT",
    "SOLX1TR", "SOLX2TR", "HELIOSTR", "FLR_TRIG", "NRMFLG", "PRMFLG", "SX1FLG", "SX2FLG", "HL1OSFLG",
    "CRPIX1", "CRPIX2", "RSUN_OBS", "DSUN_OBS", "HGLT_OBS", "HGLN_OBS", "P_ANGLE", "ROLL"
]


def extract_headers_from_file(p: Path):
    try:
        with fits.open(p) as f:
            hdr = dict(f[0].header)
    except Exception as e:
        print(f"Failed to read header from {p}: {e}")
        return None
    row = {k: hdr.get(k, None) for k in useful_keys}
    # also keep filename for reference
    row['file'] = p.name
    row['path'] = str(p)
    return row


def extract_folder(folder: Path, out_csv: Path, pattern: str = "*.fits"):
    files = sorted(folder.rglob(pattern))
    if not files:
        raise SystemExit(f"No FITS files found in {folder} (pattern={pattern})")

    all_rows = []
    for p in files:
        info = extract_headers_from_file(p)
        if info:
            all_rows.append(info)

    if not all_rows:
        raise SystemExit("No valid FITS headers extracted")

    df = pd.DataFrame(all_rows)
    # move file/path to front
    cols = ['file', 'path'] + [c for c in df.columns if c not in ('file','path')]
    df = df[cols]
    df.to_csv(out_csv, index=False)
    print(f"Wrote {len(df)} rows to {out_csv}")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dir', required=True, help='Folder containing FITS files')
    parser.add_argument('--out', required=True, help='Output CSV path')
    parser.add_argument('--pattern', default='*.fits', help='Glob pattern (default: *.fits)')
    args = parser.parse_args()

    folder = Path(args.dir).resolve()
    out = Path(args.out).resolve()
    if not folder.exists() or not folder.is_dir():
        raise SystemExit(f"Folder not found: {folder}")

    extract_folder(folder, out, args.pattern)


if __name__ == '__main__':
    main()
