(() => {
  const datasets = window.__PLAN_DATASETS__ || {};
  let activeSourceUrl = window.__SOURCE_URL__ || "";
  const refreshEveryMs = 5000;
  let selectedKey = window.__SELECTED_KEY__;

  const tabsEl = document.getElementById("tabs");
  const updatedAtEl = document.getElementById("updatedAt");
  const summaryCardsEl = document.getElementById("summaryCards");
  const planRowsEl = document.getElementById("planRows");
  const sourceLinkEl = document.getElementById("sourceLink");
  const refreshStatusEl = document.getElementById("refreshStatus");
  const refreshTimeEl = document.getElementById("refreshTime");

  const charts = {
    soc: null,
    energy: null,
    cost: null,
  };

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

    planRowsEl.innerHTML = "";

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const deltaClass = Number(row.cost_change) < 0 ? "down" : "up";
      tr.innerHTML = `
        <td>${row.time_label}</td>
        <td>${fmt.num(row.import_rate)} ${currencyMinor}</td>
        <td>${fmt.num(row.export_rate)} ${currencyMinor}</td>
        <td>${row.state_symbol || ""} ${row.state_text || ""}</td>
        <td>${row.limit || "-"}</td>
        <td>${fmt.num(row.pv_kwh)} kWh</td>
        <td>${fmt.num(row.load_kwh)} kWh</td>
        <td>${fmt.num(row.soc, 0)}%</td>
        <td class="${deltaClass}">${fmt.signedMinor(row.cost_change, currencyMinor)}</td>
        <td>${fmt.money(row.total_cost, currencyMajor)}</td>
      `;
      planRowsEl.appendChild(tr);
    });
  }

  function destroyChart(chart) {
    if (chart) {
      chart.destroy();
    }
  }

  function renderCharts(ds) {
    const rows = ds.rows || [];
    const labels = rows.map((r) => r.time_label);
    const socs = rows.map((r) => r.soc);
    const pvs = rows.map((r) => r.pv_kwh);
    const loads = rows.map((r) => r.load_kwh);
    const costChange = rows.map((r) => r.cost_change);

    destroyChart(charts.soc);
    destroyChart(charts.energy);
    destroyChart(charts.cost);

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
        maintainAspectRatio: false,
        scales: {
          y: { beginAtZero: true, max: 100 },
        },
      },
    });

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
        maintainAspectRatio: false,
      },
    });

    charts.cost = new Chart(document.getElementById("costChart"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Cost Delta",
            data: costChange,
            backgroundColor: costChange.map((v) => (Number(v) < 0 ? "#157f1f" : "#bf0603")),
          },
        ],
      },
      options: {
        maintainAspectRatio: false,
      },
    });
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
    }
  }

  render();
  updateSourceLink(activeSourceUrl);
  setRefreshStatus("info", "Starting");
  refreshData();
  setInterval(refreshData, refreshEveryMs);
})();
