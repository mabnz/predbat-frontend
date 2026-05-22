from __future__ import annotations

import json
import os
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import requests
from flask import Flask, jsonify, render_template

PRED_BAT_PLAN_URL = os.getenv("PRED_BAT_PLAN_URL", "http://predbat:5052/plan")
PRED_BAT_PLAN_URLS = os.getenv("PRED_BAT_PLAN_URLS", "")
REQUEST_TIMEOUT_SECONDS = float(os.getenv("REQUEST_TIMEOUT_SECONDS", "10"))


def _get_plan_urls() -> list[str]:
    if PRED_BAT_PLAN_URLS.strip():
        urls = [u.strip() for u in PRED_BAT_PLAN_URLS.split(",") if u.strip()]
        return urls or [PRED_BAT_PLAN_URL]

    return [
        PRED_BAT_PLAN_URL,
        "http://localhost:5052/plan",
        "http://127.0.0.1:5052/plan",
    ]


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


@dataclass
class PlanDataset:
    key: str
    label: str
    updated_at: str
    currency_symbols: list[str]
    rows: list[dict[str, Any]]
    totals: dict[str, Any]


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


@app.route("/")
@app.route("/plan")
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
        }
        for key, ds in datasets.items()
    }

    return render_template(
        "plan.html",
        source_url=source_url or PRED_BAT_PLAN_URL,
        datasets=serialized,
        selected_key=selected_key,
        error=error,
    )


@app.route("/api/plan-data")
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
