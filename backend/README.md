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
   - `POST /forecast` : Upload CSV, returns ETA
   - `GET /alerts` : Returns current risk/advisory
   - `GET /external/cactus` : (Mock) Fetches CACTus CME data
   - `GET /external/donki` : (Mock) Fetches NASA DONKI CME data

4. **Sample Data**
   - Use `../data/sample_aditya_l1.csv` for testing

---

## Notes
- Uses rolling z-score + Isolation Forest for anomaly detection
- Rule-based risk levels (green/yellow/red)
- Designed for hackathon speed, not production
