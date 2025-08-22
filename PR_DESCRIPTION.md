PR: Add Aditya-L1 CME Detection MVP

This pull request adds a minimal, hackathon-focused MVP that:

- Provides a FastAPI backend (`backend/`) with endpoints to detect CME-like events, forecast ETA, and return alerts. It uses a simple rolling z-score + Isolation Forest anomaly detector and rule-based risk levels.
- Provides a lightweight React frontend (`frontend/`) using TailwindCSS and `recharts` to upload CSV data, visualize solar wind speed & particle flux, and display risk/ETA panels.
- Includes sample data in `data/` (`sample_aditya_l1.csv` and `sample_aditya_l1_extended.csv`) that contains an injected CME-like disturbance for testing.

Notes for reviewers:

- The frontend is intentionally minimal and uses `react-scripts` for fast iteration.
- `frontend/node_modules` and Python virtual envs are ignored via `.gitignore`.
- To run locally: follow the Quickstart in `README.md`.

If you'd like, I can tidy the frontend build, add CI, or wire the external CACTus/DONKI API integration.
