# Aditya-L1 CME Detection MVP Backend

## Setup

1. **Install dependencies**
   ```sh
   pip install -r requirements.txt
   ```

2. **Run FastAPI server**
   ```sh
   uvicorn main:app --reload --port 8000
   ```

3. **Endpoints**
   - `POST /detect` : Upload CSV file, returns CME detection & risk
   - `POST /detect_suit_upload` : Upload a ZIP containing SUIT FITS files (server extracts, ingests and runs detection)
   - `POST /detect_suit_file` : Upload a single SUIT FITS file and run detection on it
   - `POST /forecast` : Upload CSV, returns ETA
   - `GET /alerts` : Returns current risk/advisory
   - `GET /external/cactus` : (Mock) Fetches CACTus CME data
   - `GET /external/donki` : (Mock) Fetches NASA DONKI CME data

4. **Sample Data**
   - Use `../data/sample_aditya_l1.csv` for testing

5. **FITS utilities**
    - `extract_fits_headers.py` : extract useful FITS header keys into a CSV
       ```sh
       python extract_fits_headers.py --dir ../data/suit_2025Aug22T041648755 --out ../data/suit_metadata.csv
       ```
    - `check_fits_for_cme.py` : scan FITS under `data/` and report if ingestion classifies a 'severe' CME (CLI)

---

## Notes
- Uses rolling z-score + Isolation Forest for anomaly detection
- Rule-based risk levels (green/yellow/red)
- Designed for hackathon speed, not production
