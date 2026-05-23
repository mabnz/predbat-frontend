(() => {
  const datasets = window.__PLAN_DATASETS__ || {};
  let activeSourceUrl = window.__SOURCE_URL__ || "";
  const refreshEveryMs = 60000;
  let selectedKey = window.__SELECTED_KEY__;

  const tabsEl = document.getElementById("tabs");
  const updatedAtEl = document.getElementById("updatedAt");
  const summaryCardsEl = document.getElementById("summaryCards");
  const planRowsEl = document.getElementById("planRows");
  const sourceLinkEl = document.getElementById("sourceLink");
  const refreshStatusEl = document.getElementById("refreshStatus");
  const refreshTimeEl = document.getElementById("refreshTime");
  const stateLegendEl = document.getElementById("stateLegend");

  const charts = {
    soc: null,
    energy: null,
    cost: null,
  };
  let refreshInFlight = false;

  const fmt = {
    num(v, digits = 2) {
      if (v === null || v === undefined || Number.isNaN(v)) {
        return "-";
      }
      return Number(v).toFixed(digits);
    },
    money(v, symbol = "$") {
      if (v === null || v === undefined || Number.isNaN(v)) {
        return "-";
      }
      return `${symbol}${Number(v).toFixed(2)}`;
    },
    signedMinor(v, symbol = "c") {
      if (v === null || v === undefined || Number.isNaN(v)) {
        return "-";
      }
      const amount = Number(v).toFixed(0);
      const sign = amount > 0 ? "+" : "";
      return `${sign}${amount} ${symbol}`;
    },
  };

  function datasetKeys() {
    return Object.keys(datasets);
  }

  function nowLabel() {
    return new Date().toLocaleTimeString();
  }

  function setRefreshStatus(kind, label) {
    if (!refreshStatusEl) {
      return;
    }

    refreshStatusEl.classList.remove("status-ok", "status-warn", "status-info");

    if (kind === "ok") {
      refreshStatusEl.classList.add("status-badge", "status-ok");
    } else if (kind === "warn") {
      refreshStatusEl.classList.add("status-badge", "status-warn");
    } else {
      refreshStatusEl.classList.add("status-badge", "status-info");
    }

    refreshStatusEl.textContent = label;

    if (refreshTimeEl) {
      refreshTimeEl.textContent = `Last checked ${nowLabel()}`;
    }
  }

  function updateSourceLink(url) {
    if (!url || !sourceLinkEl) {
      return;
    }
    sourceLinkEl.href = url;
    sourceLinkEl.textContent = url;
  }

  function replaceDatasets(nextDatasets) {
    const keys = Object.keys(datasets);
    keys.forEach((key) => {
      delete datasets[key];
    });
    Object.entries(nextDatasets || {}).forEach(([key, value]) => {
      datasets[key] = value;
    });
  }

  function setActiveTab() {
    const keys = datasetKeys();
    if (!keys.includes(selectedKey)) {
      selectedKey = keys[0] || "";
    }

    tabsEl.innerHTML = "";

    keys.forEach((key) => {
      const ds = datasets[key];
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = `tab ${key === selectedKey ? "active" : ""}`;
      btn.textContent = ds.label;
      btn.addEventListener("click", () => {
        selectedKey = key;
        render();
      });
      tabsEl.appendChild(btn);
    });
  }

  function renderSummary(ds) {
    const rows = ds.rows || [];
    const costs = rows.map((r) => r.total_cost).filter((v) => Number.isFinite(v));
    const socs = rows.map((r) => r.soc).filter((v) => Number.isFinite(v));

    const totalCost = costs.length ? costs[costs.length - 1] : ds.total_cost;
    const minSoc = socs.length ? Math.min(...socs) : null;
    const maxSoc = socs.length ? Math.max(...socs) : null;

    const currencyMajor = (ds.currency_symbols || ["$", "c"])[0] || "$";
    const currencyMinor = (ds.currency_symbols || ["$", "c"])[1] || "c";

    const cards = [
      { label: "Projected Total", value: fmt.money(totalCost, currencyMajor) },
      { label: "Final SoC", value: `${fmt.num(ds.final_soc, 0)}%` },
      { label: "Min SoC", value: `${fmt.num(minSoc, 0)}%` },
      { label: "Max SoC", value: `${fmt.num(maxSoc, 0)}%` },
      { label: "PV Forecast", value: `${fmt.num(ds.totals?.pv_forecast)} kWh` },
      { label: "Load Forecast", value: `${fmt.num(ds.totals?.load_forecast)} kWh` },
      { label: "Import Rate", value: `${fmt.num(rows[0]?.import_rate)} ${currencyMinor}` },
      { label: "Export Rate", value: `${fmt.num(rows[0]?.export_rate)} ${currencyMinor}` },
    ];

    summaryCardsEl.innerHTML = "";

    cards.forEach((card) => {
      const el = document.createElement("article");
      el.className = "card";
      el.innerHTML = `<h3>${card.label}</h3><p>${card.value}</p>`;
      summaryCardsEl.appendChild(el);
    });
  }

  function renderTable(ds) {
    const rows = ds.rows || [];
    const currencyMajor = (ds.currency_symbols || ["$", "c"])[0] || "$";
    const currencyMinor = (ds.currency_symbols || ["$", "c"])[1] || "c";

    const importRates = rows
      .map((r) => Number(r.import_rate))
      .filter((v) => Number.isFinite(v));
    const exportRates = rows
      .map((r) => Number(r.export_rate))
      .filter((v) => Number.isFinite(v));
    const lowImportRate = importRates.length ? Math.min(...importRates) + 1.0 : null;
    const minImportRate = importRates.length ? Math.min(...importRates) : null;
    const maxImportRate = importRates.length ? Math.max(...importRates) : null;
    const importSpread =
      Number.isFinite(minImportRate) && Number.isFinite(maxImportRate)
        ? maxImportRate - minImportRate
        : 0;
    const hasRealPeakWindow = importSpread >= 3;
    const highImportRate = hasRealPeakWindow
      ? maxImportRate - Math.max(1, importSpread * 0.2)
      : null;
    const strongExportRate = exportRates.length ? Math.max(...exportRates) - 0.5 : null;

    function parseLimitPercent(limitValue) {
      if (limitValue === null || limitValue === undefined) {
        return null;
      }
      const raw = String(limitValue).replace("%", "").trim();
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    }

    function classifyState(row) {
      const text = String(row.state_text || "").toLowerCase();
      const sym = String(row.state_symbol || "");
      const pv = Number(row.pv_kwh || 0);
      const load = Number(row.load_kwh || 0);
      const soc = Number(row.soc);
      const importRate = Number(row.import_rate);
      const exportRate = Number(row.export_rate);
      const costDelta = Number(row.cost_change);
      const netSolar = pv - load;
      const limitPct = parseLimitPercent(row.limit);

      const charging = sym.includes("nearr") || sym.includes("↗") || text.includes("charge");
      const discharging = sym.includes("searr") || sym.includes("↘") || text.includes("discharg");

      if (
        !charging &&
        !discharging &&
        Number.isFinite(exportRate) &&
        Number.isFinite(strongExportRate) &&
        exportRate >= strongExportRate &&
        netSolar > 0.6 &&
        costDelta < 0
      ) {
        return {
          label: "Exporting",
          emoji: "⬆️",
          className: "state-export",
          rule: `Rule: no charge/discharge and export_rate (${fmt.num(exportRate)}c) >= strong_export (${fmt.num(strongExportRate)}c) and pv-load (${fmt.num(netSolar)}kWh) > 0.6 and cost_delta (${fmt.num(costDelta)}c) < 0`,
        };
      }

      if (
        !charging &&
        !discharging &&
        Number.isFinite(limitPct) &&
        Number.isFinite(soc) &&
        soc >= limitPct - 1 &&
        netSolar > 0.25
      ) {
        return {
          label: "Charge Frozen",
          emoji: "⏸️",
          className: "state-frozen",
          rule: `Rule: no charge/discharge and soc (${fmt.num(soc, 0)}%) >= limit-1 (${fmt.num(limitPct - 1, 0)}%) and pv-load (${fmt.num(netSolar)}kWh) > 0.25`,
        };
      }

      if (charging && netSolar > 0.25) {
        return {
          label: "PV Charge",
          emoji: "☀️",
          className: "state-pv-charge",
          rule: `Rule: charging and pv-load (${fmt.num(netSolar)}kWh) > 0.25`,
        };
      }

      if (charging) {
        const cheapWindow = Number.isFinite(importRate) && Number.isFinite(lowImportRate) && importRate <= lowImportRate;
        return {
          label: "Grid Charge",
          emoji: "⚡",
          className: "state-grid-charge",
          rule: cheapWindow
            ? `Rule: charging and import_rate (${fmt.num(importRate)}c) <= low_import (${fmt.num(lowImportRate)}c)`
            : `Rule: charging and pv-load (${fmt.num(netSolar)}kWh) <= 0.25`,
        };
      }

      if (discharging) {
        if (
          hasRealPeakWindow &&
          Number.isFinite(importRate) &&
          Number.isFinite(highImportRate) &&
          importRate >= highImportRate
        ) {
          return {
            label: "Peak Shaving",
            emoji: "🪒",
            className: "state-peak",
            rule: `Rule: discharging and import_rate (${fmt.num(importRate)}c) >= high_import (${fmt.num(highImportRate)}c) with spread ${fmt.num(importSpread)}c`,
          };
        }
        return {
          label: "Discharging",
          emoji: "🔋",
          className: "state-discharge",
          rule: `Rule: discharging and not in peak tariff window`,
        };
      }

      return {
        label: "Demand",
        emoji: "🏠",
        className: "state-demand",
        rule: "Rule: no charge or discharge condition matched",
      };
    }

    if (stateLegendEl) {
      stateLegendEl.innerHTML = `
        <span class="legend-chip state-pv-charge" title="Charging while PV exceeds load">☀️ PV Charge</span>
        <span class="legend-chip state-grid-charge" title="Charging with low import price or PV deficit">⚡ Grid Charge</span>
        <span class="legend-chip state-frozen" title="PV available but charging held near target limit">⏸️ Charge Frozen</span>
        <span class="legend-chip state-export" title="Surplus likely exporting with favorable export context">⬆️ Exporting</span>
        <span class="legend-chip state-discharge" title="Battery discharging to support demand">🔋 Discharging</span>
        <span class="legend-chip state-demand" title="No active battery movement">🏠 Demand</span>
      `;
    }

    planRowsEl.innerHTML = "";

    const socMax = Number(ds.soc_max);
    const hasSocMax = Number.isFinite(socMax) && socMax > 0;

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const deltaClass = Number(row.cost_change) < 0 ? "down" : "up";
      const state = classifyState(row);

      let gridChargeCell = "-";
      if (state.label === "Grid Charge" && hasSocMax) {
        const socChange = Number(row.soc_change);
        const importRate = Number(row.import_rate);
        if (Number.isFinite(socChange) && socChange > 0 && Number.isFinite(importRate)) {
          const batteryKwh = (socChange / 100) * socMax;
          const pv = Number(row.pv_kwh || 0);
          const load = Number(row.load_kwh || 0);
          const loadShortfall = Math.max(0, load - pv);
          const gridKwh = batteryKwh + loadShortfall;
          const costMajor = (gridKwh * importRate) / 100;
          const title = `${fmt.num(gridKwh)} kWh @ ${fmt.num(importRate)} ${currencyMinor} (battery ${fmt.num(batteryKwh)} kWh + load shortfall ${fmt.num(loadShortfall)} kWh)`;
          gridChargeCell = `<span title="${title}">${fmt.money(costMajor, currencyMajor)}</span>`;
        }
      }

      tr.innerHTML = `
        <td>${row.time_label}</td>
        <td>${fmt.num(row.import_rate)} ${currencyMinor}</td>
        <td>${fmt.num(row.export_rate)} ${currencyMinor}</td>
        <td>
          <div class="state-cell">
            <span class="state-chip state-single ${state.className}" title="${state.rule}">${state.emoji} ${state.label}</span>
          </div>
        </td>
        <td>${row.limit || "-"}</td>
        <td>${fmt.num(row.pv_kwh)} kWh</td>
        <td>${fmt.num(row.load_kwh)} kWh</td>
        <td>${fmt.num(row.soc, 0)}%</td>
        <td>${gridChargeCell}</td>
        <td class="${deltaClass}">${fmt.signedMinor(row.cost_change, currencyMinor)}</td>
        <td>${fmt.money(row.total_cost, currencyMajor)}</td>
      `;
      planRowsEl.appendChild(tr);
    });
  }

  function renderCharts(ds) {
    const rows = ds.rows || [];
    const labels = rows.map((r) => r.time_label);
    const socs = rows.map((r) => r.soc);
    const pvs = rows.map((r) => r.pv_kwh);
    const loads = rows.map((r) => r.load_kwh);
    const costChange = rows.map((r) => r.cost_change);

    if (!charts.soc) {
      charts.soc = new Chart(document.getElementById("socChart"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "SoC %",
              data: socs,
              borderColor: "#007ea7",
              backgroundColor: "rgba(0, 126, 167, 0.2)",
              fill: true,
              tension: 0.25,
              pointRadius: 0,
            },
          ],
        },
        options: {
          maintainAspectRatio: true,
          aspectRatio: 3,
          animation: false,
          scales: {
            y: { beginAtZero: true, max: 100 },
          },
        },
      });
    } else {
      charts.soc.data.labels = labels;
      charts.soc.data.datasets[0].data = socs;
      charts.soc.update("none");
    }

    if (!charts.energy) {
      charts.energy = new Chart(document.getElementById("energyChart"), {
        type: "line",
        data: {
          labels,
          datasets: [
            {
              label: "PV kWh",
              data: pvs,
              borderColor: "#ff7a18",
              backgroundColor: "rgba(255, 122, 24, 0.2)",
              fill: true,
              tension: 0.25,
              pointRadius: 0,
            },
            {
              label: "Load kWh",
              data: loads,
              borderColor: "#12263a",
              backgroundColor: "rgba(18, 38, 58, 0.2)",
              fill: true,
              tension: 0.25,
              pointRadius: 0,
            },
          ],
        },
        options: {
          maintainAspectRatio: true,
          aspectRatio: 3,
          animation: false,
        },
      });
    } else {
      charts.energy.data.labels = labels;
      charts.energy.data.datasets[0].data = pvs;
      charts.energy.data.datasets[1].data = loads;
      charts.energy.update("none");
    }

    const costColors = costChange.map((v) => (Number(v) < 0 ? "#157f1f" : "#bf0603"));
    if (!charts.cost) {
      charts.cost = new Chart(document.getElementById("costChart"), {
        type: "bar",
        data: {
          labels,
          datasets: [
            {
              label: "Cost Delta",
              data: costChange,
              backgroundColor: costColors,
            },
          ],
        },
        options: {
          maintainAspectRatio: true,
          aspectRatio: 3,
          animation: false,
        },
      });
    } else {
      charts.cost.data.labels = labels;
      charts.cost.data.datasets[0].data = costChange;
      charts.cost.data.datasets[0].backgroundColor = costColors;
      charts.cost.update("none");
    }
  }

  function render() {
    setActiveTab();

    const ds = datasets[selectedKey];
    if (!ds) {
      return;
    }

    updatedAtEl.textContent = ds.updated_at ? `Updated: ${ds.updated_at}` : "";
    renderSummary(ds);
    renderTable(ds);
    renderCharts(ds);

    if (activeSourceUrl) {
      document.title = `${ds.label} | Predbat Plan Frontend`;
    }
  }

  async function refreshData() {
    if (refreshInFlight) {
      return;
    }
    refreshInFlight = true;

    try {
      const response = await fetch("/api/plan-data", {
        cache: "no-store",
        headers: { "Accept": "application/json" },
      });

      if (!response.ok) {
        setRefreshStatus("warn", "Offline");
        return;
      }

      const payload = await response.json();
      if (payload.error || !payload.datasets) {
        setRefreshStatus("warn", "Degraded");
        return;
      }

      activeSourceUrl = payload.source_url || activeSourceUrl;
      updateSourceLink(activeSourceUrl);

      replaceDatasets(payload.datasets);

      const keys = datasetKeys();
      if (!keys.includes(selectedKey)) {
        selectedKey = payload.selected_key || keys[0] || "";
      }

      render();
      setRefreshStatus("ok", "Live");
    } catch (_err) {
      // Keep showing the last successful render if a polling request fails.
      setRefreshStatus("warn", "Offline");
    } finally {
      refreshInFlight = false;
    }
  }

  render();
  updateSourceLink(activeSourceUrl);
  setRefreshStatus("info", "Starting");
  refreshData();
  setInterval(refreshData, refreshEveryMs);
})();
