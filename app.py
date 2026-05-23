# Predbat Frontend
# Version: 0.5.0
from __future__ import annotations

import functools
import json
import os
import secrets
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import requests
from authlib.integrations.flask_client import OAuth
from dotenv import load_dotenv
from flask import Flask, jsonify, redirect, render_template, request, session, url_for

load_dotenv()

__version__ = "0.5.0"

PRED_BAT_PLAN_URL = os.getenv("PRED_BAT_PLAN_URL", "")
PRED_BAT_PLAN_URLS = os.getenv("PRED_BAT_PLAN_URLS", "")
REQUEST_TIMEOUT_SECONDS = 10
REFRESH_INTERVAL_SECONDS = float(os.getenv("REFRESH_INTERVAL_SECONDS", "180"))

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "")
GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "")
OAUTH_REDIRECT_BASE_URL = os.getenv("OAUTH_REDIRECT_BASE_URL", "").rstrip("/")
ALLOWED_EMAILS = {
    e.strip().lower()
    for e in os.getenv("ALLOWED_EMAILS", "").split(",")
    if e.strip()
}
SECRET_KEY = os.getenv("SECRET_KEY") or secrets.token_hex(32)
DEV_BYPASS_AUTH = os.getenv("DEV_BYPASS_AUTH", "").lower() in ("1", "true", "yes")
DEV_USER_EMAIL = os.getenv("DEV_USER_EMAIL", "dev@localhost")


def _get_plan_urls() -> list[str]:
    if PRED_BAT_PLAN_URLS.strip():
        urls = [u.strip() for u in PRED_BAT_PLAN_URLS.split(",") if u.strip()]
        if urls:
            return urls

    if PRED_BAT_PLAN_URL.strip():
        return [PRED_BAT_PLAN_URL.strip()]

    return []


def _extract_json_object(source: str, marker: str) -> dict[str, Any] | None:
    idx = source.find(marker)
    if idx < 0:
        return None

    start = source.find("{", idx)
    if start < 0:
        return None

    depth = 0
    in_string: str | None = None
    escaped = False

    for pos in range(start, len(source)):
        ch = source[pos]

        if in_string:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == in_string:
                in_string = None
            continue

        if ch == '"' or ch == "'":
            in_string = ch
            continue

        if ch == "{":
            depth += 1
        elif ch == "}":
            depth -= 1
            if depth == 0:
                try:
                    return json.loads(source[start : pos + 1])
                except json.JSONDecodeError:
                    return None

    return None


def _parse_time(value: str) -> str:
    try:
        dt = datetime.fromisoformat(value)
    except ValueError:
        return value
    return dt.strftime("%a %H:%M")


def _to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_datetime(value: str) -> datetime | None:
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


def _state_from_soc_change(value: float) -> tuple[str, str]:
    if value > 0.05:
        return "&nearr;", "Charging"
    if value < -0.05:
        return "&searr;", "Discharging"
    return "&rarr;", "Demand"


def _aggregate_rows_hourly(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[int, int, int, int], dict[str, Any]] = {}
    order: list[tuple[int, int, int, int]] = []

    for row in rows:
        dt = _parse_datetime(str(row.get("time", "")))
        if dt is None:
            continue

        key = (dt.year, dt.month, dt.day, dt.hour)
        if key not in buckets:
            hour_dt = dt.replace(minute=0, second=0, microsecond=0)
            buckets[key] = {
                "time": hour_dt.isoformat(),
                "import_rate_sum": 0.0,
                "import_rate_count": 0,
                "export_rate_sum": 0.0,
                "export_rate_count": 0,
                "pv_kwh_sum": 0.0,
                "load_kwh_sum": 0.0,
                "cost_change_sum": 0.0,
                "soc_change_sum": 0.0,
                "soc_last": None,
                "total_cost_last": None,
                "state_target": "",
            }
            order.append(key)

        bucket = buckets[key]

        import_rate = _to_float(row.get("import_rate"))
        if import_rate is not None:
            bucket["import_rate_sum"] += import_rate
            bucket["import_rate_count"] += 1

        export_rate = _to_float(row.get("export_rate"))
        if export_rate is not None:
            bucket["export_rate_sum"] += export_rate
            bucket["export_rate_count"] += 1

        pv_kwh = _to_float(row.get("pv_forecast"))
        if pv_kwh is not None:
            bucket["pv_kwh_sum"] += pv_kwh

        load_kwh = _to_float(row.get("load_forecast"))
        if load_kwh is not None:
            bucket["load_kwh_sum"] += load_kwh

        cost_change = _to_float(row.get("cost_change"))
        if cost_change is not None:
            bucket["cost_change_sum"] += cost_change

        soc_change = _to_float(row.get("soc_change"))
        if soc_change is not None:
            bucket["soc_change_sum"] += soc_change

        soc = _to_float(row.get("soc_percent"))
        if soc is not None:
            bucket["soc_last"] = soc

        total_cost = _to_float(row.get("total_cost"))
        if total_cost is not None:
            bucket["total_cost_last"] = total_cost

        state_target = row.get("state_target")
        if state_target:
            bucket["state_target"] = state_target

    aggregated: list[dict[str, Any]] = []
    for key in order:
        bucket = buckets[key]
        import_rate_count = bucket["import_rate_count"]
        export_rate_count = bucket["export_rate_count"]
        soc_change_sum = bucket["soc_change_sum"]
        state_symbol, state_text = _state_from_soc_change(soc_change_sum)

        aggregated.append(
            {
                "time": bucket["time"],
                "import_rate": (
                    bucket["import_rate_sum"] / import_rate_count if import_rate_count else None
                ),
                "export_rate": (
                    bucket["export_rate_sum"] / export_rate_count if export_rate_count else None
                ),
                "state_html": state_symbol,
                "state_text": state_text,
                "state_target": bucket["state_target"],
                "pv_forecast": bucket["pv_kwh_sum"],
                "load_forecast": bucket["load_kwh_sum"],
                "soc_percent": bucket["soc_last"],
                "soc_change": soc_change_sum,
                "cost_change": bucket["cost_change_sum"],
                "total_cost": bucket["total_cost_last"],
            }
        )

    return aggregated


@dataclass
class PlanDataset:
    key: str
    label: str
    updated_at: str
    currency_symbols: list[str]
    rows: list[dict[str, Any]]
    totals: dict[str, Any]
    soc_max: float | None = None
    current_soc: float | None = None


    @property
    def total_cost(self) -> float | None:
        total = self.totals.get("total_cost")
        return _to_float(total)


    @property
    def final_soc(self) -> float | None:
        total_soc = self.totals.get("soc_percent")
        return _to_float(total_soc)


def _make_dataset(key: str, label: str, payload: dict[str, Any]) -> PlanDataset:
    rows: list[dict[str, Any]] = payload.get("rows", [])
    transformed_rows: list[dict[str, Any]] = []

    for row in rows:
        transformed_rows.append(
            {
                "time": row.get("time", ""),
                "time_label": _parse_time(row.get("time", "")),
                "import_rate": _to_float(row.get("import_rate")),
                "export_rate": _to_float(row.get("export_rate")),
                "state_text": row.get("state_text", ""),
                "state_symbol": row.get("state_html", ""),
                "limit": row.get("state_target", ""),
                "pv_kwh": _to_float(row.get("pv_forecast")),
                "load_kwh": _to_float(row.get("load_forecast")),
                "soc": _to_float(row.get("soc_percent")),
                "soc_change": _to_float(row.get("soc_change")),
                "cost_change": _to_float(row.get("cost_change")),
                "total_cost": _to_float(row.get("total_cost")),
            }
        )

    return PlanDataset(
        key=key,
        label=label,
        updated_at=payload.get("timestamp") or payload.get("time") or "",
        currency_symbols=payload.get("currency_symbols", ["$", "c"]),
        rows=transformed_rows,
        totals=payload.get("totals", {}),
        soc_max=_to_float(payload.get("soc_max")),
        current_soc=_to_float(payload.get("soc")),
    )


def _fetch_plan_payloads() -> tuple[dict[str, PlanDataset], str | None, str | None]:
    html = ""
    used_url: str | None = None
    errors: list[str] = []

    for url in _get_plan_urls():
        try:
            response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
            response.raise_for_status()
            html = response.text
            used_url = url
            break
        except requests.RequestException as exc:
            errors.append(f"{url}: {exc}")

    if not html:
        attempted = " | ".join(errors) if errors else "No URLs configured."
        return {}, f"Unable to fetch plan page. Attempts: {attempted}", None

    candidates = {
        "plan": ("Plan", "window.planData = "),
        "yesterday": ("Yesterday", "window.yesterdayData = "),
        "baseline": ("Without Predbat", "window.baselineData = "),
    }

    datasets: dict[str, PlanDataset] = {}

    for key, (label, marker) in candidates.items():
        payload = _extract_json_object(html, marker)
        if payload:
            datasets[key] = _make_dataset(key, label, payload)

    if not datasets:
        return {}, "No embedded plan datasets were found in the source page.", used_url

    return datasets, None, used_url


app = Flask(__name__)
app.secret_key = SECRET_KEY
app.config.update(
    SESSION_COOKIE_HTTPONLY=True,
    SESSION_COOKIE_SAMESITE="Lax",
    SESSION_COOKIE_SECURE=OAUTH_REDIRECT_BASE_URL.startswith("https://"),
)

oauth = OAuth(app)
oauth.register(
    name="google",
    client_id=GOOGLE_CLIENT_ID,
    client_secret=GOOGLE_CLIENT_SECRET,
    server_metadata_url="https://accounts.google.com/.well-known/openid-configuration",
    client_kwargs={"scope": "openid email profile"},
)


def _is_localhost_request() -> bool:
    # Use the raw socket peer address; intentionally do NOT trust
    # X-Forwarded-For so the bypass cannot be triggered from outside.
    remote = (request.remote_addr or "").lower()
    return remote in ("127.0.0.1", "::1", "localhost")


def _is_authenticated() -> bool:
    if DEV_BYPASS_AUTH and _is_localhost_request():
        if not session.get("user"):
            session["user"] = {"email": DEV_USER_EMAIL, "name": "Dev User"}
        return True
    user = session.get("user") or {}
    email = (user.get("email") or "").lower()
    if not email:
        return False
    if not ALLOWED_EMAILS:
        return True
    return email in ALLOWED_EMAILS


def require_auth(view):
    @functools.wraps(view)
    def wrapper(*args, **kwargs):
        if _is_authenticated():
            return view(*args, **kwargs)
        if request.path.startswith("/api/"):
            return jsonify({"error": "unauthorized"}), 401
        session["next_url"] = request.full_path if request.query_string else request.path
        return redirect(url_for("welcome"))

    return wrapper


@app.route("/welcome")
def welcome():
    if _is_authenticated():
        return redirect(url_for("plan"))
    return render_template(
        "welcome.html",
        version=__version__,
    )


@app.route("/auth/login")
def auth_login():
    if not GOOGLE_CLIENT_ID or not GOOGLE_CLIENT_SECRET:
        return (
            "Google OAuth is not configured. Set GOOGLE_CLIENT_ID and "
            "GOOGLE_CLIENT_SECRET in the environment.",
            500,
        )
    redirect_uri = url_for("auth_callback", _external=True)
    if OAUTH_REDIRECT_BASE_URL:
        redirect_uri = f"{OAUTH_REDIRECT_BASE_URL}{url_for('auth_callback')}"
    return oauth.google.authorize_redirect(redirect_uri)


@app.route("/auth/callback")
def auth_callback():
    try:
        token = oauth.google.authorize_access_token()
    except Exception as exc:  # noqa: BLE001
        return f"Authentication failed: {exc}", 400

    user_info = token.get("userinfo") or {}
    if not user_info:
        # Fallback for older flows
        try:
            user_info = oauth.google.parse_id_token(token)
        except Exception:  # noqa: BLE001
            user_info = {}

    email = (user_info.get("email") or "").lower()
    if not email:
        return "Authentication failed: no email returned.", 400
    if ALLOWED_EMAILS and email not in ALLOWED_EMAILS:
        return f"Access denied for {email}.", 403

    session["user"] = {
        "email": email,
        "name": user_info.get("name"),
        "picture": user_info.get("picture"),
    }
    next_url = session.pop("next_url", None) or url_for("plan")
    return redirect(next_url)


@app.route("/auth/logout")
def auth_logout():
    session.clear()
    return redirect(url_for("welcome"))


@app.route("/")
@app.route("/plan")
@require_auth
def plan() -> str:
    datasets, error, source_url = _fetch_plan_payloads()
    selected_key = "plan" if "plan" in datasets else next(iter(datasets.keys()), "")

    serialized = {
        key: {
            "key": ds.key,
            "label": ds.label,
            "updated_at": ds.updated_at,
            "currency_symbols": ds.currency_symbols,
            "rows": ds.rows,
            "totals": ds.totals,
            "total_cost": ds.total_cost,
            "final_soc": ds.final_soc,
            "soc_max": ds.soc_max,
        }
        for key, ds in datasets.items()
    }

    return render_template(
        "plan.html",
        source_url=source_url or PRED_BAT_PLAN_URL,
        datasets=serialized,
        selected_key=selected_key,
        error=error,
        version=__version__,
        refresh_interval_ms=int(REFRESH_INTERVAL_SECONDS * 1000),
        current_user=session.get("user"),
    )


@app.route("/api/plan-data")
@require_auth
def plan_data_api() -> Any:
    datasets, error, source_url = _fetch_plan_payloads()
    selected_key = "plan" if "plan" in datasets else next(iter(datasets.keys()), "")

    serialized = {
        key: {
            "key": ds.key,
            "label": ds.label,
            "updated_at": ds.updated_at,
            "currency_symbols": ds.currency_symbols,
            "rows": ds.rows,
            "totals": ds.totals,
            "total_cost": ds.total_cost,
            "final_soc": ds.final_soc,
            "soc_max": ds.soc_max,
        }
        for key, ds in datasets.items()
    }

    return jsonify(
        {
            "source_url": source_url or PRED_BAT_PLAN_URL,
            "datasets": serialized,
            "selected_key": selected_key,
            "error": error,
        }
    )


if __name__ == "__main__":
    app.run(debug=True, host="0.0.0.0", port=5053)
