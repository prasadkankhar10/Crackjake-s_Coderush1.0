# Aditya-L1 CME Detection MVP

A hackathon-ready tool to detect, classify, and forecast CME (Coronal Mass Ejection) events using simulated Aditya-L1 payload data.

## Project Structure

```
backend/   # FastAPI backend (ML, endpoints)
frontend/  # React + TailwindCSS frontend
data/      # Sample/mock Aditya-L1 data
```

## Quickstart

### 1. Backend
```sh
cd backend
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### 2. Frontend
```sh
cd ../frontend
npm install
npm start
```

### 3. Demo
- Open [http://localhost:3000](http://localhost:3000)
- Upload `../data/sample_aditya_l1.csv`
- See CME detection, risk, ETA, and plots

---

## Features
- Simulated Aditya-L1 data (solar wind, flux, irradiance)
- Anomaly detection (z-score + isolation forest)
- CME intensity classification & ETA forecast
- Rule-based alert system (green/yellow/red)
- Simple, modern UI (React + Tailwind + recharts)
- (Optional) External CME API integration (CACTus, DONKI)

---

## Notes
- Designed for hackathon speed, not production
- All code is lightweight and runnable on a laptop
