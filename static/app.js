(() => {
  const datasets = window.__PLAN_DATASETS__ || {};
  let activeSourceUrl = window.__SOURCE_URL__ || "";
  const refreshEveryMs = Number(window.__REFRESH_INTERVAL_MS__) > 0
    ? Number(window.__REFRESH_INTERVAL_MS__)
    : 180000;
  let selectedKey = window.__SELECTED_KEY__;

  const tabsEl = document.getElementById("tabs");
  const summaryCardsEl = document.getElementById("summaryCards");
  const planRowsEl = document.getElementById("planRows");
  const sourceLinkEl = document.getElementById("sourceLink");
  const refreshStatusEl = document.getElementById("refreshStatus");
  const refreshTimeEl = document.getElementById("refreshTime");
  const stateLegendEl = document.getElementById("stateLegend");
  const chartsToggleEl = document.getElementById("chartsToggle");
  const chartsContainerEl = document.getElementById("chartsContainer");

  // Dark mode toggle
  const THEME_KEY = "predbatTheme";
  const themeToggleEl = document.getElementById("themeToggle");
  const themeIconEl = themeToggleEl?.querySelector(".theme-toggle-icon");

  function applyTheme(theme) {
    const isDark = theme === "dark";
    document.documentElement.classList.toggle("dark-mode", isDark);
    if (themeIconEl) themeIconEl.textContent = isDark ? "☀️" : "🌙";
    if (themeToggleEl) {
      themeToggleEl.setAttribute(
        "aria-label",
        isDark ? "Switch to light mode" : "Switch to dark mode"
      );
      themeToggleEl.title = isDark ? "Switch to light mode" : "Switch to dark mode";
    }
  }

  let storedTheme = null;
  try {
    storedTheme = window.localStorage?.getItem(THEME_KEY);
  } catch (_err) {
    storedTheme = null;
  }
  const prefersDark =
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches;
  applyTheme(storedTheme || (prefersDark ? "dark" : "light"));

  if (themeToggleEl) {
    themeToggleEl.addEventListener("click", () => {
      const next = document.documentElement.classList.contains("dark-mode")
        ? "light"
        : "dark";
      applyTheme(next);
      try {
        window.localStorage?.setItem(THEME_KEY, next);
      } catch (_err) {
        // ignore
      }
    });
  }

  const CHARTS_HIDDEN_KEY = "predbatChartsHidden";
  let chartsHidden = true;
  try {
    const stored = window.localStorage?.getItem(CHARTS_HIDDEN_KEY);
    if (stored !== null && stored !== undefined) {
      chartsHidden = stored === "1";
    }
  } catch (_err) {
    chartsHidden = true;
  }

  function applyChartsVisibility() {
    if (!chartsContainerEl || !chartsToggleEl) {
      return;
    }
    chartsContainerEl.style.display = chartsHidden ? "none" : "";
    chartsToggleEl.textContent = chartsHidden ? "▼" : "▲";
    chartsToggleEl.setAttribute("aria-expanded", chartsHidden ? "false" : "true");
  }

  if (chartsToggleEl) {
    chartsToggleEl.addEventListener("click", () => {
      chartsHidden = !chartsHidden;
      try {
        window.localStorage?.setItem(CHARTS_HIDDEN_KEY, chartsHidden ? "1" : "0");
      } catch (_err) {
        // ignore storage errors
      }
      applyChartsVisibility();
      if (!chartsHidden) {
        const ds = datasets[selectedKey];
        if (ds) {
          renderCharts(ds);
        }
      }
    });
  }
  applyChartsVisibility();

  const charts = {
    energy: null,
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
  }

  function updatePredbatTimestamp(ds) {
    if (!refreshTimeEl) return;
    const raw = ds?.updated_at;
    if (!raw) {
      refreshTimeEl.textContent = "";
      return;
    }
    const dt = new Date(raw);
    if (Number.isNaN(dt.getTime())) {
      refreshTimeEl.textContent = `Plan last updated ${raw}`;
      return;
    }
    refreshTimeEl.textContent = `Plan last updated ${dt
      .toLocaleString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
      .replace(/\b(am|pm)\b/i, (m) => m.toUpperCase())}`;
  }

  function updateHeroBattery(ds) {
    const el = document.getElementById("heroBattery");
    if (!el) return;
    const rows = ds?.rows || [];
    const first = rows[0];
    const soc = Number(first?.soc);
    if (!Number.isFinite(soc)) {
      el.textContent = "";
      return;
    }
    const pct = Math.max(0, Math.min(100, soc));
    const hue = pct * 1.2; // 0 (red) → 120 (green)
    const fillColor = `hsl(${hue.toFixed(0)}, 65%, 45%)`;
    const fillWidth = (pct / 100) * 30; // inner usable width
    el.innerHTML = `
      <svg class="hero-battery-icon" viewBox="0 0 40 18" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
        <rect x="1" y="2" width="34" height="14" rx="2" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/>
        <rect x="36" y="6" width="3" height="6" rx="1" fill="currentColor"/>
        <rect x="3" y="4" width="${fillWidth.toFixed(2)}" height="10" rx="1" fill="${fillColor}"/>
      </svg>
      <span class="hero-battery-value" style="color: ${fillColor}">${pct.toFixed(0)}%</span>
    `;
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
    const keys = datasetKeys().filter((key) => key === "plan");
    if (!keys.includes(selectedKey)) {
      selectedKey = keys[0] || "";
    }

    tabsEl.innerHTML = "";

    if (keys.length <= 1) {
      tabsEl.style.display = "none";
      return;
    }
    tabsEl.style.display = "";

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

    let windowLabel = "";
    if (rows.length >= 2) {
      const first = new Date(rows[0].time);
      const last = new Date(rows[rows.length - 1].time);
      if (!Number.isNaN(first.getTime()) && !Number.isNaN(last.getTime())) {
        // Add 30 minutes to last slot start so the duration represents the full coverage.
        const totalMinutes = Math.max(0, (last - first) / 60000 + 30);
        const totalHours = Math.round(totalMinutes / 60);
        windowLabel = `${totalHours}H`;
      }
    }

    // Split projected cost into today vs tomorrow if we have a full forecast
    // for tomorrow (>= 40 of 48 half-hour slots covered).
    let todayCost = null;
    let tomorrowCost = null;
    let tomorrowComplete = false;
    if (rows.length) {
      const first = new Date(rows[0].time);
      if (!Number.isNaN(first.getTime())) {
        const todayKey = first.toDateString();
        const tomorrowDate = new Date(first);
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrowKey = tomorrowDate.toDateString();

        let todayLastTotal = null;
        let tomorrowLastTotal = null;
        let tomorrowSlotCount = 0;
        rows.forEach((r) => {
          const total = Number(r.total_cost);
          if (!Number.isFinite(total)) return;
          const d = new Date(r.time);
          if (Number.isNaN(d.getTime())) return;
          const key = d.toDateString();
          if (key === todayKey) {
            todayLastTotal = total;
          } else if (key === tomorrowKey) {
            tomorrowLastTotal = total;
            tomorrowSlotCount += 1;
          }
        });

        if (todayLastTotal !== null) {
          todayCost = todayLastTotal;
        }
        if (tomorrowLastTotal !== null) {
          tomorrowCost = tomorrowLastTotal - (todayLastTotal || 0);
          tomorrowComplete = tomorrowSlotCount >= 48;
        }
      }
    }

    // Pull today's already-incurred cost from the yesterdayData dataset.
    // Predbat's "Yesterday" tab includes yesterday + today-so-far (up to "now").
    let todaySpentSoFar = null;
    const yesterdayDs = datasets.yesterday;
    if (yesterdayDs && Array.isArray(yesterdayDs.rows) && rows.length) {
      const planFirst = new Date(rows[0].time);
      if (!Number.isNaN(planFirst.getTime())) {
        const todayKey = planFirst.toDateString();
        let todayStartTotal = null;
        let todayEndTotal = null;
        yesterdayDs.rows.forEach((r) => {
          const total = Number(r.total_cost);
          if (!Number.isFinite(total)) return;
          const d = new Date(r.time);
          if (Number.isNaN(d.getTime())) return;
          if (d.toDateString() !== todayKey) return;
          if (todayStartTotal === null) {
            // First today row gives us the cumulative offset to subtract.
            todayStartTotal = total;
          }
          todayEndTotal = total;
        });
        if (todayStartTotal !== null && todayEndTotal !== null) {
          // total_cost is cumulative across the whole yesterdayData window,
          // so the spend just for today = end - (start - first slot delta).
          // Using inclusive endpoints: include the first today slot's cost too.
          const firstTodayRow = yesterdayDs.rows.find((r) => {
            const d = new Date(r.time);
            return !Number.isNaN(d.getTime()) && d.toDateString() === todayKey;
          });
          const firstDelta = Number(firstTodayRow?.cost_change) || 0;
          todaySpentSoFar = todayEndTotal - todayStartTotal + firstDelta;
        }
      }
    }

    const cards = [];
    if (todaySpentSoFar !== null) {
      const totalTodayProjected = (todayCost ?? totalCost ?? 0) + todaySpentSoFar;
      cards.push({
        label: "Projected Cost Today",
        value: fmt.money(totalTodayProjected, currencyMajor),
        type: "cost-today",
      });
    }
    cards.push({
      label: "PV Forecast",
      subLabel: windowLabel,
      value: `${fmt.num(ds.totals?.pv_forecast)} kWh`,
      type: "pv",
    });
    cards.push({
      label: "Load Forecast",
      subLabel: windowLabel,
      value: `${fmt.num(ds.totals?.load_forecast)} kWh`,
      type: "load",
    });

    summaryCardsEl.innerHTML = "";

    cards.forEach((card) => {
      const el = document.createElement("article");
      el.className = `card card-${card.type || "default"}`;
      const sub = card.subLabel ? `<span class="card-sub">${card.subLabel}</span>` : "";
      el.innerHTML = `<h3>${card.label}${sub}</h3><p>${card.value}</p>`;
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

    const allTariffs = new Set();
    rows.forEach((r) => {
      const ir = Number(r.import_rate);
      const er = Number(r.export_rate);
      if (Number.isFinite(ir)) allTariffs.add(ir.toFixed(2));
      if (Number.isFinite(er)) allTariffs.add(er.toFixed(2));
    });
    const sortedTariffs = [...allTariffs].sort((a, b) => parseFloat(a) - parseFloat(b));
    const tariffColors = {};
    const totalTariffs = sortedTariffs.length || 1;
    // Restricted to blue → purple hues only (200–280) so tariff colors are
    // visually distinct from any red/green warmth used elsewhere.
    const HUE_START = 200;
    const HUE_END = 280;
    sortedTariffs.forEach((rate, idx) => {
      const hue =
        totalTariffs > 1
          ? Math.round(HUE_START + (idx * (HUE_END - HUE_START)) / (totalTariffs - 1))
          : Math.round((HUE_START + HUE_END) / 2);
      // Alternate lightness slightly to improve discrimination when many tariffs.
      const lightness = idx % 2 === 0 ? 72 : 62;
      tariffColors[rate] = `hsla(${hue}, 60%, ${lightness}%, 0.55)`;
    });

    function tariffStyle(value) {
      if (!Number.isFinite(Number(value))) return "";
      const key = Number(value).toFixed(2);
      const color = tariffColors[key];
      return color ? ` style="background: ${color}"` : "";
    }

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
        const grid = gridImportKwh(row);
        if (grid !== null && grid > 0.05) {
          return {
            label: "Battery",
            emoji: "🔋",
            className: "state-discharge-grid",
            rule: `Rule: discharging and grid import (${fmt.num(grid)} kWh) needed to meet load (load ${fmt.num(load)} − pv ${fmt.num(pv)} kWh exceeds battery output)`,
          };
        }
        return {
          label: "Discharging",
          emoji: "🔋",
          className: "state-discharge",
          rule: `Rule: discharging and not in peak tariff window`,
        };
      }

      const grid = gridImportKwh(row);
      const atMinimum = Number.isFinite(soc) && soc <= 5;
      const lockLabel = atMinimum ? "Minimum battery level" : "Discharge Lock";
      const lockEmoji = atMinimum ? "🪫" : "🔒";

      if (grid !== null && grid > 0.05) {
        return {
          label: lockLabel,
          emoji: lockEmoji,
          className: "state-demand",
          rule: `Rule: no charge/discharge (battery at ${fmt.num(soc, 0)}%) and grid import (${fmt.num(grid)} kWh) supplying load (load ${fmt.num(load)} − pv ${fmt.num(pv)} kWh)`,
        };
      }

      return {
        label: lockLabel,
        emoji: lockEmoji,
        className: "state-demand",
        rule: `Rule: no charge or discharge (battery at ${fmt.num(soc, 0)}%), no grid import`,
      };
    }

    if (stateLegendEl) {
      stateLegendEl.innerHTML = `
        <span class="legend-chip state-pv-charge" title="Charging while PV exceeds load">☀️ PV Charge</span>
        <span class="legend-chip state-grid-charge" title="Charging with low import price or PV deficit">⚡ Grid Charge</span>
        <span class="legend-chip state-frozen" title="PV available but charging held near target limit">⏸️ Charge Frozen</span>
        <span class="legend-chip state-export" title="Surplus likely exporting with favorable export context">⬆️ Exporting</span>
        <span class="legend-chip state-discharge" title="Battery discharging to support demand">🔋 Discharging</span>
        <span class="legend-chip state-discharge-grid" title="Battery discharging but grid is also supplementing load">🔋 Battery</span>
        <span class="legend-chip state-demand" title="Battery held at reserve">🔒 Discharge Lock</span>
        <span class="legend-chip state-demand" title="Battery held at the minimum reserve (5%)">🪫 Minimum battery level</span>
      `;
    }

    planRowsEl.innerHTML = "";

    const socMax = Number(ds.soc_max);
    const hasSocMax = Number.isFinite(socMax) && socMax > 0;

    function gridImportKwh(row) {
      if (!hasSocMax) return null;
      const socChange = Number(row.soc_change);
      const pv = Number(row.pv_kwh || 0);
      const load = Number(row.load_kwh || 0);
      if (!Number.isFinite(socChange)) return null;
      const batteryKwh = (socChange / 100) * socMax;
      return load - pv + batteryKwh;
    }

    rows.forEach((row) => {
      const tr = document.createElement("tr");
      const state = classifyState(row);

      // Cost cell is driven by Predbat's per-slot cost_change (in major units).
      // We never synthesise a cost when Predbat itself reports none.
      let gridChargeCell = "-";
      let gridCostStyle = "";
      const costChangeMajor = Number(row.cost_change);
      if (Number.isFinite(costChangeMajor) && Math.abs(costChangeMajor) >= 0.005) {
        const costMinor = costChangeMajor * 100;
        if (costMinor > 0) {
          gridChargeCell = `<span title="Predbat slot cost: +${costMinor.toFixed(0)}${currencyMinor}">+${costMinor.toFixed(0)}${currencyMinor}</span>`;
          gridCostStyle = ` style="background: rgba(191, 6, 3, 0.18)"`;
        } else {
          gridChargeCell = `<span title="Predbat slot earnings: ${costMinor.toFixed(0)}${currencyMinor}">${costMinor.toFixed(0)}${currencyMinor}</span>`;
          gridCostStyle = ` style="background: rgba(21, 127, 31, 0.18)"`;
        }
      }

      let socCellStyle = "";
      const socPct = Number(row.soc);
      if (Number.isFinite(socPct)) {
        const clamped = Math.max(0, Math.min(100, socPct));
        const hue = clamped * 1.2; // 0 (red) → 120 (green)
        socCellStyle = ` style="background: hsla(${hue.toFixed(0)}, 70%, 55%, 0.35)"`;
      }

      const gridForIcon = gridImportKwh(row);
      const hasPredbatCost = Number.isFinite(costChangeMajor) && costChangeMajor >= 0.005;
      const showGridIcon = hasPredbatCost && gridForIcon !== null && gridForIcon > 0.05;
      const gridIconHtml = showGridIcon
        ? `<img class="grid-tower-icon" src="/static/img/transmission-tower.avif" alt="" title="Grid importing ${fmt.num(gridForIcon)} kWh">`
        : "";

      tr.innerHTML = `
        <td>${row.time_label}</td>
        <td${tariffStyle(row.import_rate)}>${fmt.num(row.import_rate)}${currencyMinor}</td>
        <td${tariffStyle(row.export_rate)}>${fmt.num(row.export_rate)}${currencyMinor}</td>
        <td>
          <div class="state-cell">
            <span class="state-chip state-single ${state.className}" title="${state.rule}">${state.emoji} ${state.label}</span>
            ${gridIconHtml}
          </div>
        </td>
        <td>${row.limit || "-"}</td>
        <td>${Number(row.pv_kwh) > 0 ? `${fmt.num(row.pv_kwh)} kWh` : "-"}</td>
        <td>${fmt.num(row.load_kwh)} kWh</td>
        <td${socCellStyle}>${fmt.num(row.soc, 0)}%</td>
        <td class="grid-cost-cell"${gridCostStyle}>${gridChargeCell}</td>
        <td>${fmt.money(row.total_cost, currencyMajor)}</td>
      `;
      planRowsEl.appendChild(tr);
    });
  }

  function renderCharts(ds) {
    if (chartsHidden) {
      return;
    }
    const rows = ds.rows || [];
    const labels = rows.map((r) => r.time_label);
    const pvs = rows.map((r) => r.pv_kwh);
    const loads = rows.map((r) => r.load_kwh);

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
          aspectRatio: 2,
          animation: false,
        },
      });
    } else {
      charts.energy.data.labels = labels;
      charts.energy.data.datasets[0].data = pvs;
      charts.energy.data.datasets[1].data = loads;
      charts.energy.update("none");
    }
  }

  function render() {
    setActiveTab();

    const ds = datasets[selectedKey];
    if (!ds) {
      return;
    }

    renderSummary(ds);
    renderTable(ds);
    renderCharts(ds);
    updatePredbatTimestamp(ds);
    updateHeroBattery(ds);

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

  // Table scroll fade indicators
  const tableWrapEl = document.getElementById("tableWrap");
  const tableScrollEl = document.getElementById("tableScroll");

  function updateTableFades() {
    if (!tableWrapEl || !tableScrollEl) return;
    const { scrollTop, scrollHeight, clientHeight } = tableScrollEl;
    const hasMoreTop = scrollTop > 2;
    const hasMoreBottom = scrollTop + clientHeight < scrollHeight - 2;
    tableWrapEl.classList.toggle("has-fade-top", hasMoreTop);
    tableWrapEl.classList.toggle("has-fade-bottom", hasMoreBottom);
  }

  if (tableScrollEl) {
    tableScrollEl.addEventListener("scroll", updateTableFades, { passive: true });
    window.addEventListener("resize", updateTableFades);
  }

  render();
  updateSourceLink(activeSourceUrl);
  setRefreshStatus("info", "Starting");
  refreshData();
  setInterval(refreshData, refreshEveryMs);
  setInterval(updateTableFades, 1000);
})();
