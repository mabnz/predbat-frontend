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

This project loads configuration from a `.env` file in the project root.

Copy the example template and edit it with your Predbat host:

```bash
cp .env.example .env
# edit .env and set PRED_BAT_PLAN_URL
```

Supported variables:

- `PRED_BAT_PLAN_URL` — required, URL of your Predbat `/plan` page
- `PRED_BAT_PLAN_URLS` — optional comma-separated fallback list, tried in order
- `REQUEST_TIMEOUT_SECONDS` — optional, request timeout in seconds (default `10`)

The `.env` file is gitignored.

## Run As A Systemd Service (Ubuntu)

The repo includes a templated unit file and installer script that deploy the
app to `/opt/predbat-frontend` and run it under your user account.

```bash
sudo ./scripts/install-service.sh           # installs as predbat-frontend@$USER
# or specify a different user:
sudo ./scripts/install-service.sh myuser
```

The installer will:

1. Copy the source tree to `/opt/predbat-frontend`.
2. Create `.env` from `.env.example` if not already present (edit before starting!).
3. Create a Python virtual environment and install requirements.
4. Install the systemd unit at `/etc/systemd/system/predbat-frontend@.service`.
5. Enable and start `predbat-frontend@<user>.service`.

Useful commands:

```bash
systemctl status predbat-frontend@$USER.service
journalctl -u predbat-frontend@$USER.service -f
sudo systemctl restart predbat-frontend@$USER.service
```

To uninstall:

```bash
sudo ./scripts/uninstall-service.sh
```

The default port is `5053`. To change it, edit the `ExecStart` line in
`/etc/systemd/system/predbat-frontend@.service` and run
`sudo systemctl daemon-reload && sudo systemctl restart predbat-frontend@$USER.service`.
