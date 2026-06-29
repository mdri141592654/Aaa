// today_tab.js
import { INDICATOR_REGISTRY } from "./indicators.js";
import { computeCurrentValues, runTodayScan, defaultTolerance } from "./today_scan.js";
import { drawForwardChart } from "./chart.js";

const TIMEFRAME_LABELS = { "1d": "1 Tag", "1h": "1 Stunde", "5m": "5 Minuten" };

export function initTodayTab({ manifest, getBars }) {
  const panel = document.getElementById("todayConfigPanel");
  const resultsPanel = document.getElementById("todayResultsPanel");
  const symbols = Object.keys(manifest.symbols || {});

  panel.innerHTML = `
    <h2 class="section-title" style="margin-top:0">Heutige Bedingungen</h2>
    <p class="hint" style="margin-bottom:1rem">
      Das Programm liest die aktuellen Werte der gewählten Indikatoren
      (letzte verfügbare Kerze) und sucht in der gesamten Historie nach
      Situationen mit ähnlichen Werten.
    </p>

    <div class="field-group">
      <label for="todaySymbol">Markt</label>
      <select id="todaySymbol">
        ${symbols.map(s => `<option value="${s}">${s}</option>`).join("")}
      </select>
    </div>

    <div class="field-group">
      <label for="todayTimeframe">Zeiteinheit</label>
      <select id="todayTimeframe"></select>
    </div>

    <p id="todayDataMeta" class="data-meta"></p>

    <div class="field-group">
      <label for="todayForward">Prognose-Horizont (Kerzen nach Signal)</label>
      <input type="number" id="todayForward" value="20" min="1" max="200" />
    </div>

    <h2 class="section-title">Indikatoren wählen</h2>
    <p class="hint">
      Nur gewählte Indikatoren werden ausgewertet. Die Toleranz bei
      numerischen Indikatoren ist anpassbar (±Wert).
    </p>

    <div style="display:flex;gap:0.5rem;margin-bottom:0.5rem">
      <button type="button" class="btn-ghost" id="todayCheckAll"
        style="margin:0;padding:0.3rem 0.6rem;font-size:0.78rem;width:auto">Alle</button>
      <button type="button" class="btn-ghost" id="todayCheckNone"
        style="margin:0;padding:0.3rem 0.6rem;font-size:0.78rem;width:auto">Keine</button>
    </div>

    <div id="todayIndicatorList" class="auto-indicator-list">
      ${Object.values(INDICATOR_REGISTRY).map(def => `
        <label class="auto-indicator-item">
          <input type="checkbox" class="today-ind-cb" value="${def.id}"
            ${["regime","rsi","smi"].includes(def.id) ? "checked" : ""} />
          <span>${def.label}</span>
        </label>`).join("")}
    </div>

    <button type="button" class="btn-primary" id="todayRunBtn" style="margin-top:1rem">
      Jetzt analysieren
    </button>
    <p id="todayStatus" class="status" role="status"></p>`;

  // Timeframe-Dropdown befüllen
  const refreshTF = () => {
    const sym  = document.getElementById("todaySymbol").value;
    const tfs  = Object.keys(manifest.symbols[sym]?.timeframes || {});
    const order = ["1d", "1h", "5m"];
    document.getElementById("todayTimeframe").innerHTML = order
      .filter(tf => tfs.includes(tf))
      .map(tf => `<option value="${tf}">${TIMEFRAME_LABELS[tf] || tf}</option>`)
      .join("");
    updateMeta();
  };

  const updateMeta = () => {
    const sym  = document.getElementById("todaySymbol")?.value;
    const tf   = document.getElementById("todayTimeframe")?.value;
    const info = manifest.symbols[sym]?.timeframes?.[tf];
    const el   = document.getElementById("todayDataMeta");
    if (el) el.textContent = info
      ? `${info.bars.toLocaleString("de-DE")} Kerzen · ${fmt(info.from)} – ${fmt(info.to)}`
      : "";
  };

  document.getElementById("todaySymbol").addEventListener("change", refreshTF);
  document.getElementById("todayTimeframe")?.addEventListener("change", updateMeta);
  document.getElementById("todayCheckAll").addEventListener("click", () => {
    document.querySelectorAll(".today-ind-cb").forEach(cb => cb.checked = true);
  });
  document.getElementById("todayCheckNone").addEventListener("click", () => {
    document.querySelectorAll(".today-ind-cb").forEach(cb => cb.checked = false);
  });
  document.getElementById("todayRunBtn").addEventListener("click", () =>
    handleTodayRun({ manifest, getBars, resultsPanel }));

  refreshTF();
}

async function handleTodayRun({ manifest, getBars, resultsPanel }) {
  const symbol      = document.getElementById("todaySymbol").value;
  const timeframe   = document.getElementById("todayTimeframe").value;
  const forwardSteps = Number(document.getElementById("todayForward").value) || 20;

  const checkedIds = Array.from(document.querySelectorAll(".today-ind-cb:checked"))
    .map(cb => cb.value);
  if (!checkedIds.length) {
    setStatus("Mindestens einen Indikator wählen.", true); return;
  }

  const selectedIndicators = checkedIds.map(id => {
    const def = INDICATOR_REGISTRY[id];
    const params = {};
    def.params.forEach(p => { params[p.key] = p.default; });
    return { id, params };
  });

  setStatus("Lade Daten …", false);
  document.getElementById("todayRunBtn").disabled = true;

  try {
    const bars = await getBars(symbol, timeframe);
    if (!bars || bars.length < 50) { setStatus("Zu wenig Daten.", true); return; }

    setStatus("Berechne aktuelle Werte …", false);
    const indicatorResults = computeCurrentValues(bars, selectedIndicators);

    // Toleranz-UI anzeigen, dann auf Bestätigung warten
    renderToleranceUI(indicatorResults, () => {
      const tolerances = indicatorResults.map((ir, k) => {
        const inp = document.getElementById(`tol_${k}`);
        return inp ? Number(inp.value) : defaultTolerance(ir.def, ir.currentValue);
      });

      setStatus("Scanne historische Daten …", false);
      setTimeout(() => {
        try {
          const result = runTodayScan({ bars, indicatorResults, tolerances, forwardSteps });
          renderTodayResults(result, forwardSteps, symbol, timeframe, indicatorResults);
          setStatus(
            `Fertig: ${result.sampleSize} Treffer in ${result.totalBars.toLocaleString("de-DE")} Kerzen.`,
            false
          );
        } catch (e) {
          console.error(e); setStatus("Fehler: " + e.message, true);
        } finally {
          document.getElementById("todayRunBtn").disabled = false;
        }
      }, 30);
    });

  } catch (e) {
    console.error(e); setStatus("Fehler: " + e.message, true);
    document.getElementById("todayRunBtn").disabled = false;
  }
}

function renderToleranceUI(indicatorResults, onConfirm) {
  const panel = document.getElementById("todayResultsPanel");

  const rows = indicatorResults.map((ir, k) => {
    const v = ir.currentValue;
    const isNull = v === null || v === undefined;
    const isCat  = ir.def.valueType === "category";
    const tol    = defaultTolerance(ir.def, v);

    return `
      <div class="tol-row">
        <div class="tol-ind-label">${ir.def.label}</div>
        <div class="tol-current">
          <span class="tol-label">Aktueller Wert</span>
          <span class="tol-value ${isNull ? "c-bear" : ""}">
            ${isNull ? "–" : isCat ? String(v).toUpperCase() : Number(v).toFixed(3)}
          </span>
        </div>
        ${isNull ? `<div class="tol-warn">⚠ Kein Wert (Indikator braucht mehr Daten)</div>` : ""}
        ${!isNull && !isCat ? `
          <div class="tol-control">
            <label for="tol_${k}">Toleranz ±</label>
            <input type="number" id="tol_${k}" value="${tol.toFixed(4)}"
              step="${tol > 1 ? 0.1 : 0.0001}" min="0" class="tol-input" />
          </div>` : ""}
        ${!isNull && isCat ? `
          <div class="tol-control">
            <span class="cond-tag">${ir.def.label} = ${v}</span>
            <span style="font-size:0.72rem;color:var(--muted);margin-left:0.4rem">
              (exakter Wert, keine Toleranz)
            </span>
          </div>` : ""}
      </div>`;
  }).join("");

  panel.innerHTML = `
    <div class="tol-header">
      <h3 style="margin:0 0 0.35rem">Aktuelle Indikator-Werte</h3>
      <p class="hint" style="margin:0 0 1rem">
        Numerische Werte: Toleranzband anpassen, dann Scan starten.<br>
        Kategorie-Werte werden exakt abgeglichen.
      </p>
    </div>
    <div class="tol-grid">${rows}</div>
    <button type="button" class="btn-primary" id="todayConfirmBtn"
      style="margin-top:1rem">Mit diesen Werten scannen</button>`;

  document.getElementById("todayConfirmBtn").addEventListener("click", onConfirm);
}

function renderTodayResults(result, forwardSteps, symbol, timeframe, indicatorResults) {
  const fc  = v => v > 0.02 ? "positive" : v < -0.02 ? "negative" : "";
  const pf  = result.profitFactor;
  const rp  = document.getElementById("todayResultsPanel");

  const condBadges = result.conditionLabels.map(l =>
    `<span class="cond-tag">${l}</span>`).join(" ");

  rp.innerHTML = `
    <div class="today-conds">${condBadges}</div>

    <div class="stat-grid">
      <div class="stat-card"><div class="stat-label">Treffer</div>
        <div class="stat-value">${result.sampleSize}</div></div>
      <div class="stat-card"><div class="stat-label">Ø Return nach ${forwardSteps} Kerzen</div>
        <div class="stat-value ${fc(result.avgPath?.[forwardSteps])}">
          ${formatPct(result.avgPath?.[forwardSteps])}</div></div>
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
        <div class="stat-value ${fc(result.expectedValue)}">${formatPct(result.expectedValue)}</div></div>
      <div class="stat-card"><div class="stat-label">Gesamt-Kerzen</div>
        <div class="stat-value">${result.totalBars.toLocaleString("de-DE")}</div></div>
    </div>

    <div class="chart-wrap">
      <canvas id="todayChart"></canvas>
      <p class="chart-caption">
        Ø %-Verlauf nach Signal · jede dünne Linie = ein historischer Treffer · Band = ±1 Std.-Abw.
      </p>
    </div>

    <div class="signals-section">
      <h3>Trefferdaten (${symbol}, ${TIMEFRAME_LABELS[timeframe] || timeframe})</h3>
      <div class="signals-list">${formatDates(result.matchDates)}</div>
    </div>

    <button type="button" class="btn-ghost" id="todayBackBtn"
      style="margin-top:1rem">← Indikatoren neu wählen</button>`;

  const canvas = document.getElementById("todayChart");
  drawForwardChart(canvas, result, forwardSteps);
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => drawForwardChart(canvas, result, forwardSteps), 120);
  });

  document.getElementById("todayBackBtn").addEventListener("click", () => {
    document.getElementById("todayResultsPanel").innerHTML = `
      <div class="empty-state">
        <p>Indikatoren wählen und <strong>Jetzt analysieren</strong> tippen.</p>
      </div>`;
    document.getElementById("todayRunBtn").disabled = false;
    setStatus("", false);
  });
}

function formatDates(dates) {
  if (!dates || !dates.length) return "Keine Treffer.";
  return [...dates].sort((a, b) => a < b ? 1 : -1).slice(0, 60)
    .map(t => fmt(t)).join("<br/>");
}

function formatPct(v) {
  if (v === null || v === undefined) return "–";
  return (v > 0 ? "+" : "") + v.toFixed(2) + "%";
}

function fmt(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("de-DE", {
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit",
  });
}

function setStatus(text, isError) {
  const el = document.getElementById("todayStatus");
  if (!el) return;
  el.textContent = text;
  el.classList.toggle("error", !!isError);
}
