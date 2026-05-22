# Predbat Plan Frontend

A Python frontend that fetches only the Predbat `/plan` page, extracts the embedded JSON datasets, and renders a cleaner dashboard UI.

## What It Includes

- Single-page dashboard for Predbat plan data
- Tabs for available datasets from the `/plan` page:
  - Plan
  - Yesterday
  - Without Predbat
- Visual charts for:
  - Battery SoC
  - PV vs Load
  - Cost delta by slot
- Detailed time-slot table with sticky headers
- Flask app compatible with Waitress

## Run Locally

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python app.py
```

Open `http://localhost:5053/plan`.

## Run With Waitress

```bash
source .venv/bin/activate
waitress-serve --listen=0.0.0.0:5053 app:app
```

## Configuration

Environment variables:

- `PRED_BAT_PLAN_URL` (default primary: `http://predbat:5052/plan`)
- `PRED_BAT_PLAN_URLS` (optional comma-separated list, tried in order)
- `REQUEST_TIMEOUT_SECONDS` (default: `10`)

If `PRED_BAT_PLAN_URLS` is not set, the app tries:

1. `PRED_BAT_PLAN_URL`
2. `http://localhost:5052/plan`
3. `http://127.0.0.1:5052/plan`

Example:

```bash
export PRED_BAT_PLAN_URLS="http://localhost:5052/plan,http://predbat:5052/plan"
waitress-serve --listen=0.0.0.0:5053 app:app
```
