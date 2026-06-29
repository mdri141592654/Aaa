// app.js
import { INDICATOR_REGISTRY, runScan } from "./indicators.js";
import { drawForwardChart } from "./chart.js";
import { runAutoSearch, rate, estimateCombos } from "./auto_search.js";
import { initTodayTab } from "./today_tab.js";

const symbolSelect     = document.getElementById("symbolSelect");
const timeframeSelect  = document.getElementById("timeframeSelect");
const dataMeta         = document.getElementById("dataMeta");
const dataGenerated    = document.getElementById("dataGenerated");
const forwardStepsInput = document.getElementById("forwardSteps");
const conditionsList   = document.getElementById("conditionsList");
const addConditionBtn  = document.getElementById("addConditionBtn");
const scanBtn          = document.getElementById("scanBtn");
const statusMsg        = document.getElementById("statusMsg");
const resultsPanel     = document.getElementById("resultsPanel");
const rowTemplate      = document.getElementById("conditionRowTemplate");
const autoConfigPanel  = document.getElementById("autoConfigPanel");
const autoResultsPanel = document.getElementById("autoResultsPanel");

const TIMEFRAME_LABELS = { "1d": "1 Tag", "1h": "1 Stunde", "5m": "5 Minuten" };

let manifest = null;
let barsCache = new Map();
let rowCounter = 0;

const OPERATORS_NUMERIC = [
  { value: "gte", label: "≥ größer/gleich" },
  { value: "lte", label: "≤ kleiner/gleich" },
  { value: "gt",  label: "> größer" },
  { value: "lt",  label: "< kleiner" },
  { value: "between", label: "zwischen" },
];

// ================================================================ Init

async function init() {
  try {
    const res = await fetch("data/manifest.json", { cache: "no-store" });
    manifest = await res.json();
  } catch (e) {
    manifest = { symbols: {}, generated_at: null };
  }

  const symbols = Object.keys(manifest.symbols || {});
  if (symbols.length === 0) { showEmptyDataWarning(); return; }

  dataGenerated.textContent = manifest.generated_at
    ? "Daten aktualisiert: " + formatTimestamp(manifest.generated_at) : "";

  symbolSelect.innerHTML = symbols.map(s => `<option value="${s}">${s}</option>`).join("");
  symbolSelect.addEventListener("change", refreshTimeframeOptions);
  timeframeSelect.addEventListener("change", updateDataMeta);
  refreshTimeframeOptions();

  addConditionBtn.addEventListener("click", () => addConditionRow());
  scanBtn.addEventListener("click", handleScan);
  addConditionRow("regime");

  // Tab-Umschaltung
  document.querySelectorAll(".tab-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      btn.classList.add("active");
      document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    });
  });

  // Today-Tab initialisieren
  initTodayTab({ manifest, getBars });

  // Auto-Such-Tab initialisieren
  initAutoSearch();
}

// =========================================================== Market UI

function showEmptyDataWarning() {
  resultsPanel.innerHTML = `
    <div class="empty-state">
      <p><strong>Noch keine Kursdaten vorhanden.</strong></p>
      <p class="empty-state-sub">Im GitHub-Repo unter
        <em>Actions → Update market data → Run workflow</em> einmal manuell starten.
      </p>
    </div>`;
  scanBtn.disabled = true;
  addConditionBtn.disabled = true;
}

function refreshTimeframeOptions() {
  const sym  = symbolSelect.value;
  const tfs  = Object.keys(manifest.symbols[sym]?.timeframes || {});
  const order = ["1d", "1h", "5m"];
  timeframeSelect.innerHTML = order
    .filter(tf => tfs.includes(tf))
    .map(tf => `<option value="${tf}">${TIMEFRAME_LABELS[tf] || tf}</option>`)
    .join("");
  updateDataMeta();
}

function updateDataMeta() {
  const info = manifest.symbols[symbolSelect.value]?.timeframes?.[timeframeSelect.value];
  dataMeta.textContent = info
    ? `${info.bars.toLocaleString("de-DE")} Kerzen · ${formatTimestamp(info.from)} – ${formatTimestamp(info.to)}`
    : "";
}

// ====================================================== Manual: Rows

function addConditionRow(defaultId) {
  rowCounter++;
  const node = rowTemplate.content.firstElementChild.cloneNode(true);
  node.dataset.rowId = "row" + rowCounter;

  const sel = node.querySelector(".indicator-select");
  sel.innerHTML = Object.values(INDICATOR_REGISTRY)
    .map(def => `<option value="${def.id}">${def.label}</option>`).join("");
  sel.value = defaultId || Object.keys(INDICATOR_REGISTRY)[0];
  sel.addEventListener("change", () => renderRowBody(node));
  node.querySelector(".remove-btn").addEventListener("click", () => node.remove());

  conditionsList.appendChild(node);
  renderRowBody(node);
}

function renderRowBody(node) {
  const def = INDICATOR_REGISTRY[node.querySelector(".indicator-select").value];

  node.querySelector(".params-row").innerHTML = def.params.map(p => `
    <div class="param-field">
      <label>${p.label}</label>
      <input type="number" class="param-input" data-key="${p.key}"
             value="${p.default}" min="${p.min}" max="${p.max}" step="1" />
    </div>`).join("");

  const cc = node.querySelector(".condition-control");
  if (def.valueType === "category") {
    cc.innerHTML = `
      <div>
        <label>Bedingung</label>
        <select class="cond-category">
          ${def.categories.map(c =>
            `<option value="${c.value}">ist ${c.label}</option>`).join("")}
        </select>
      </div>`;
  } else {
    cc.innerHTML = `
      <div><label>Vergleich</label>
        <select class="cond-op">
          ${OPERATORS_NUMERIC.map(o =>
            `<option value="${o.value}">${o.label}</option>`).join("")}
        </select>
      </div>
      <div><label>Wert</label>
        <input type="number" class="cond-value" step="0.1" value="0" />
      </div>
      <div class="cond-value2-wrap" style="display:none">
        <label>bis</label>
        <input type="number" class="cond-value2" step="0.1" value="0" />
      </div>`;
    const op = cc.querySelector(".cond-op");
    const v2 = cc.querySelector(".cond-value2-wrap");
    op.addEventListener("change", () => {
      v2.style.display = op.value === "between" ? "" : "none";
    });
  }
}

function readConditionRows() {
  return Array.from(conditionsList.querySelectorAll(".condition-row")).map(node => {
    const id  = node.querySelector(".indicator-select").value;
    const def = INDICATOR_REGISTRY[id];
    const params = {};
    node.querySelectorAll(".param-input").forEach(i => { params[i.dataset.key] = Number(i.value); });
    let condition;
    if (def.valueType === "category") {
      condition = { op: "eq", value: node.querySelector(".cond-category").value };
    } else {
      const op = node.querySelector(".cond-op").value;
      condition = { op,
        value:  Number(node.querySelector(".cond-value").value),
        value2: Number(node.querySelector(".cond-value2")?.value ?? 0) };
    }
    return { id, params, condition };
  });
}

// ====================================================== Manual: Scan

async function getBars(symbol, timeframe) {
  const key = symbol + "_" + timeframe;
  if (barsCache.has(key)) return barsCache.get(key);
  const res = await fetch(`data/${key}.json`, { cache: "no-store" });
  if (!res.ok) throw new Error("Daten konnten nicht geladen werden (" + res.status + ")");
  const bars = await res.json();
  barsCache.set(key, bars);
  return bars;
}

async function handleScan() {
  const symbol       = symbolSelect.value;
  const timeframe    = timeframeSelect.value;
  const forwardSteps = Math.max(1, Number(forwardStepsInput.value) || 20);
  const configs      = readConditionRows();
  if (!configs.length) { setStatus("Mindestens einen Indikator hinzufügen.", true); return; }

  setStatus("Lade Daten und scanne …", false);
  scanBtn.disabled = true;
  try {
    const bars = await getBars(symbol, timeframe);
    if (!bars || bars.length < forwardSteps + 20) {
      setStatus("Zu wenig historische Daten.", true); return;
    }
    const result = runScan(bars, configs, forwardSteps);
    renderResults(result, forwardSteps, timeframe, symbol);
    setStatus(
      `Fertig: ${result.sampleSize} Treffer in ${result.totalBars.toLocaleString("de-DE")} Kerzen.`,
      false);
  } catch (e) {
    console.error(e); setStatus("Fehler: " + e.message, true);
  } finally {
    scanBtn.disabled = false;
  }
}

function setStatus(text, isError) {
  statusMsg.textContent = text;
  statusMsg.classList.toggle("error", !!isError);
}

// =================================================== Manual: Render

function renderResults(result, forwardSteps, timeframe, symbol) {
  const fc = v => v > 0.02 ? "positive" : v < -0.02 ? "negative" : "";
  const pf = result.profitFactor;

  resultsPanel.innerHTML = `
    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Treffer</div>
        <div class="stat-value">${result.sampleSize}</div></div>
      <div class="stat-card"><div class="stat-label">Ø Return nach ${forwardSteps} Kerzen</div>
        <div class="stat-value ${fc(result.avgPath[forwardSteps])}">
          ${formatPct(result.avgPath[forwardSteps])}</div></div>
      <div class="stat-card"><div class="stat-label">Median Return</div>
        <div class="stat-value ${fc(result.median)}">${formatPct(result.median)}</div></div>
      <div class="stat-card"><div class="stat-label">Trefferquote (positiv)</div>
        <div class="stat-value">
          ${result.winRate !== null ? result.winRate.toFixed(1) + "%" : "–"}</div></div>
      <div class="stat-card"><div class="stat-label">Größter Gewinn</div>
        <div class="stat-value positive">${formatPct(result.maxGain)}</div></div>
      <div class="stat-card"><div class="stat-label">Größter Verlust</div>
        <div class="stat-value negative">${formatPct(result.maxLoss)}</div></div>
      <div class="stat-card"><div class="stat-label">Profit Factor</div>
        <div class="stat-value ${pf !== null && pf >= 1 ? "positive" : "negative"}">
          ${pf !== null ? pf.toFixed(2) : "–"}</div></div>
      <div class="stat-card"><div class="stat-label">Erwartungswert / Trade</div>
        <div class="stat-value ${fc(result.expectedValue)}">
          ${formatPct(result.expectedValue)}</div></div>
      <div class="stat-card"><div class="stat-label">Offene Signale</div>
        <div class="stat-value">${result.openSignals.length}</div></div>
    </div>
    <div class="chart-wrap">
      <canvas id="forwardChart"></canvas>
      <p class="chart-caption">
        Durchschnittlicher %-Kursverlauf nach Signal (dicke Linie) ·
        jede dünne Linie ist ein einzelner Treffer · Band = ±1 Std.-Abw.
      </p>
    </div>
    <div class="signals-section">
      <h3>Letzte Trefferdaten (${symbol}, ${TIMEFRAME_LABELS[timeframe] || timeframe})</h3>
      <div class="signals-list">${formatSignalsList(result)}</div>
    </div>`;

  const canvas = document.getElementById("forwardChart");
  drawForwardChart(canvas, result, forwardSteps);
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => drawForwardChart(canvas, result, forwardSteps), 120);
  });
}

function formatSignalsList(result) {
  const all = [
    ...result.matchDates.map(t  => [t, false]),
    ...result.openSignals.map(t => [t, true]),
  ].sort((a, b) => a[0] < b[0] ? 1 : -1).slice(0, 60);
  return all.length === 0 ? "Keine Treffer." : all
    .map(([t, open]) =>
      formatTimestamp(t) + (open ? '<span class="open-tag">offen</span>' : ""))
    .join("<br/>");
}

// ================================================== Auto-Search: Init

function initAutoSearch() {
  const symbols = Object.keys(manifest.symbols || {});

  autoConfigPanel.innerHTML = `
    <h2 class="section-title" style="margin-top:0">Auto-Suche</h2>
    <p class="hint" style="margin-bottom:1rem">
      Das System testet alle Kombinationen und validiert per Walk-Forward
      (2/3 In-Sample · 1/3 Out-of-Sample).
    </p>

    <div class="field-group">
      <label for="autoSymbolSelect">Markt</label>
      <select id="autoSymbolSelect">
        ${symbols.map(s => `<option value="${s}">${s}</option>`).join("")}
      </select>
    </div>

    <div class="field-group">
      <label for="autoTimeframeSelect">Zeiteinheit</label>
      <select id="autoTimeframeSelect"></select>
    </div>

    <p id="autoDataMeta" class="data-meta"></p>

    <div class="field-group">
      <label>Suchtiefe – max. gleichzeitige Indikatoren</label>
      <select id="autoDepth">
        <option value="1">1 – Einzel-Bedingungen</option>
        <option value="2" selected>2 – alle Paare</option>
        <option value="3">3 – alle Tripel</option>
      </select>
    </div>

    <div class="field-group">
      <label for="autoForward">Prognose-Horizont (Kerzen nach Signal)</label>
      <input type="number" id="autoForward" value="20" min="1" max="200" />
    </div>

    <div class="field-group">
      <label for="autoMinSamples">Min. Treffer im In-Sample</label>
      <input type="number" id="autoMinSamples" value="20" min="5" max="200" />
    </div>

    <h2 class="section-title">Indikatoren zur Suche</h2>
    <p class="hint">Nur gewählte Indikatoren werden kombiniert.</p>

    <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem">
      <button type="button" class="btn-ghost" id="autoCheckAll"
        style="margin:0;padding:0.3rem 0.6rem;font-size:0.78rem;width:auto">Alle</button>
      <button type="button" class="btn-ghost" id="autoCheckNone"
        style="margin:0;padding:0.3rem 0.6rem;font-size:0.78rem;width:auto">Keine</button>
    </div>

    <div id="autoIndicatorList" class="auto-indicator-list">
      ${Object.values(INDICATOR_REGISTRY).map(def => `
        <label class="auto-indicator-item">
          <input type="checkbox" class="auto-ind-cb" value="${def.id}"
            ${["regime","rsi","smi","macdRegime","roc"].includes(def.id) ? "checked" : ""} />
          <span>${def.label}</span>
        </label>`).join("")}
    </div>

    <p id="autoEstimate" class="hint"
      style="margin-top:0.5rem;font-family:var(--font-mono)"></p>

    <button type="button" class="btn-primary" id="autoSearchBtn"
      style="margin-top:0.75rem">Suche starten</button>

    <div id="autoProgress" style="display:none;margin-top:0.75rem">
      <div style="background:var(--panel-border);border-radius:6px;height:4px;overflow:hidden">
        <div id="autoProgressBar"
          style="height:100%;background:var(--accent);width:0%;transition:width 0.4s ease">
        </div>
      </div>
      <p class="hint" id="autoProgressLabel" style="margin:0.3rem 0 0">Bitte warten …</p>
    </div>

    <p id="autoStatus" class="status" role="status"></p>`;

  const refreshAutoTF = () => {
    const sym  = document.getElementById("autoSymbolSelect").value;
    const tfs  = Object.keys(manifest.symbols[sym]?.timeframes || {});
    const order = ["1d", "1h", "5m"];
    document.getElementById("autoTimeframeSelect").innerHTML = order
      .filter(tf => tfs.includes(tf))
      .map(tf => `<option value="${tf}">${TIMEFRAME_LABELS[tf] || tf}</option>`)
      .join("");
    updateAutoDataMeta();
  };

  const updateAutoDataMeta = () => {
    const sym  = document.getElementById("autoSymbolSelect")?.value;
    const tf   = document.getElementById("autoTimeframeSelect")?.value;
    const info = manifest.symbols[sym]?.timeframes?.[tf];
    const el   = document.getElementById("autoDataMeta");
    if (el) el.textContent = info
      ? `${info.bars.toLocaleString("de-DE")} Kerzen · ${formatTimestamp(info.from)} – ${formatTimestamp(info.to)}`
      : "";
  };

  const updateEstimate = () => {
    const n   = document.querySelectorAll(".auto-ind-cb:checked").length;
    const d   = Number(document.getElementById("autoDepth").value);
    const est = estimateCombos(n, d);
    const el  = document.getElementById("autoEstimate");
    el.textContent = `≈ ${est.toLocaleString("de-DE")} Kombinationen`;
    el.style.color = est > 50000 ? "var(--bear)" : est > 5000 ? "var(--accent)" : "var(--muted)";
  };

  document.getElementById("autoSymbolSelect").addEventListener("change", refreshAutoTF);
  document.getElementById("autoTimeframeSelect").addEventListener("change", updateAutoDataMeta);
  document.getElementById("autoCheckAll").addEventListener("click", () => {
    document.querySelectorAll(".auto-ind-cb").forEach(cb => cb.checked = true);
    updateEstimate();
  });
  document.getElementById("autoCheckNone").addEventListener("click", () => {
    document.querySelectorAll(".auto-ind-cb").forEach(cb => cb.checked = false);
    updateEstimate();
  });
  document.querySelectorAll(".auto-ind-cb").forEach(cb =>
    cb.addEventListener("change", updateEstimate));
  document.getElementById("autoDepth").addEventListener("change", updateEstimate);
  document.getElementById("autoSearchBtn").addEventListener("click", handleAutoSearch);

  refreshAutoTF();
  updateEstimate();
}

// =============================================== Auto-Search: Handler

async function handleAutoSearch() {
  const symbol       = document.getElementById("autoSymbolSelect").value;
  const timeframe    = document.getElementById("autoTimeframeSelect").value;
  const maxDepth     = Number(document.getElementById("autoDepth").value);
  const forwardSteps = Number(document.getElementById("autoForward").value);
  const minSamples   = Number(document.getElementById("autoMinSamples").value);

  const checkedIds = Array.from(document.querySelectorAll(".auto-ind-cb:checked"))
    .map(cb => cb.value);
  if (!checkedIds.length) { setAutoStatus("Mindestens einen Indikator wählen.", true); return; }

  const selectedIndicators = checkedIds.map(id => {
    const def = INDICATOR_REGISTRY[id];
    const params = {};
    def.params.forEach(p => { params[p.key] = p.default; });
    return { id, params };
  });

  const btn = document.getElementById("autoSearchBtn");
  btn.disabled = true;
  setAutoStatus("", false);
  setProgress(true, 0, "Lade Kursdaten …");

  try {
    const bars = await getBars(symbol, timeframe);
    if (!bars || bars.length < 100) { setAutoStatus("Zu wenig Daten.", true); return; }

    setProgress(true, 0.1, "Berechne Indikatoren und durchsuche Kombinationen …");
    await sleep(40);

    const result = runAutoSearch({ bars, selectedIndicators, maxDepth, forwardSteps, minSamples });

    setProgress(true, 1, "Fertig.");
    await sleep(300);
    setProgress(false);

    renderAutoResults(result, symbol, timeframe, forwardSteps, minSamples);
    setAutoStatus(
      `${result.totalCombos.toLocaleString("de-DE")} Kombinationen · ` +
      `${result.passed} bestanden IS-Filter · ` +
      `Top ${result.results.length} validiert.`, false);
  } catch (e) {
    console.error(e); setAutoStatus("Fehler: " + e.message, true); setProgress(false);
  } finally {
    btn.disabled = false;
  }
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function setAutoStatus(text, isError) {
  const el = document.getElementById("autoStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}

function setProgress(visible, value = 0, label = "") {
  const wrap = document.getElementById("autoProgress");
  const bar  = document.getElementById("autoProgressBar");
  const lbl  = document.getElementById("autoProgressLabel");
  if (!wrap) return;
  wrap.style.display = visible ? "" : "none";
  if (bar) bar.style.width = (value * 100) + "%";
  if (lbl) lbl.textContent = label;
}

// ================================================ Auto-Search: Render

function renderAutoResults(result, symbol, timeframe, forwardSteps, minSamples) {
  const { results, split, n } = result;

  const rows = results.map((res, i) => {
    const desc = res.combo
      .map(c => `<span class="cond-tag">${c.indLabel}: ${c.condLabel}</span>`)
      .join(" <span style='color:var(--muted)'>+</span> ");
    const { is, oos } = res;
    const r  = rate(res);
    const pc = v => v > 0 ? "c-bull" : "c-bear";
    const wc = v => v > 50 ? "c-bull" : "c-bear";
    return `
      <tr>
        <td class="td-num">${i + 1}</td>
        <td class="td-combo">${desc}</td>
        <td class="td-num">${is.n}</td>
        <td class="td-num ${wc(is.wr)}">${is.wr.toFixed(1)}%</td>
        <td class="td-num ${pc(is.ev)}">${formatPct(is.ev)}</td>
        <td class="td-num">${oos ? oos.n : "–"}</td>
        <td class="td-num ${oos ? wc(oos.wr) : ""}">${oos ? oos.wr.toFixed(1) + "%" : "–"}</td>
        <td class="td-num ${oos ? pc(oos.ev) : ""}">${oos ? formatPct(oos.ev) : "–"}</td>
        <td><span class="badge ${r.cls}">${r.label}</span></td>
      </tr>`;
  }).join("");

  autoResultsPanel.innerHTML = `
    <div class="wf-info">
      <div class="wf-block">
        <div class="wf-label">In-Sample (2/3) · Suche</div>
        <div class="wf-value">${split.toLocaleString("de-DE")} Kerzen</div>
        <div class="wf-sub">Kombination wird hier optimiert</div>
      </div>
      <div class="wf-sep">→</div>
      <div class="wf-block">
        <div class="wf-label">Out-of-Sample (1/3) · Validierung</div>
        <div class="wf-value">${(n - split).toLocaleString("de-DE")} Kerzen</div>
        <div class="wf-sub">Unbekannte Daten · kein Einfluss auf Suche</div>
      </div>
    </div>
    <div class="result-table-wrap">
      <table class="result-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Kombination</th>
            <th colspan="3" class="th-group th-is">In-Sample &nbsp;Hits · Win% · EV</th>
            <th colspan="3" class="th-group th-oos">Out-of-Sample &nbsp;Hits · Win% · EV</th>
            <th>Bewertung</th>
          </tr>
        </thead>
        <tbody>
          ${rows || `<tr><td colspan="9" class="td-empty">
            Keine Kombination hat den IS-Filter bestanden (min. ${minSamples} Treffer).
          </td></tr>`}
        </tbody>
      </table>
    </div>`;
}

// ================================================================ Utils

function formatPct(v) {
  if (v === null || v === undefined) return "–";
  return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
}

function formatTimestamp(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

init();
