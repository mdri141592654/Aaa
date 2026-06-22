// auto_search.js
import { INDICATOR_REGISTRY, evalCondition } from "./indicators.js";

// ---------------------------------------------------------------------------
// Schwellenwerte automatisch aus IS-Daten ableiten (kein Look-Ahead)
// ---------------------------------------------------------------------------

function generateConditions(series, def) {
  if (def.valueType === "category") {
    return def.categories.map(c => ({ op: "eq", value: c.value, label: `= ${c.label}` }));
  }
  const vals = series.filter(v => v !== null && isFinite(v)).sort((a, b) => a - b);
  if (vals.length < 20) return [];
  const p = pct => vals[Math.max(0, Math.floor(pct * vals.length) - 1)];
  const f = v => Math.abs(v) >= 10 ? v.toFixed(1) : v.toPrecision(3);
  return [
    { op: "lte", value: p(0.10), label: `≤${f(p(0.10))} (10.Pz)` },
    { op: "lte", value: p(0.20), label: `≤${f(p(0.20))} (20.Pz)` },
    { op: "lte", value: p(0.30), label: `≤${f(p(0.30))} (30.Pz)` },
    { op: "gte", value: p(0.70), label: `≥${f(p(0.70))} (70.Pz)` },
    { op: "gte", value: p(0.80), label: `≥${f(p(0.80))} (80.Pz)` },
    { op: "gte", value: p(0.90), label: `≥${f(p(0.90))} (90.Pz)` },
  ];
}

// ---------------------------------------------------------------------------
// Statistiken für eine Ergebnismenge
// ---------------------------------------------------------------------------

function computeStats(returns) {
  const n = returns.length;
  if (n === 0) return null;
  const wins = returns.filter(r => r > 0);
  const losses = returns.filter(r => r < 0);
  const gp = wins.reduce((a, b) => a + b, 0);
  const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
  const wr = (wins.length / n) * 100;
  const pf = gl === 0 ? null : gp / gl;
  const aw = wins.length > 0 ? gp / wins.length : 0;
  const al = losses.length > 0 ? gl / losses.length : 0;
  const ev = (wr / 100) * aw - ((100 - wr) / 100) * al;
  return { n, wr, pf, ev };
}

// ---------------------------------------------------------------------------
// Hilfsfunktionen: Kombinatorik
// ---------------------------------------------------------------------------

function getCombinations(arr, k) {
  if (k === 0) return [[]];
  if (arr.length < k) return [];
  const [h, ...t] = arr;
  return [...getCombinations(t, k - 1).map(c => [h, ...c]), ...getCombinations(t, k)];
}

function cartesian(arrays) {
  return arrays.reduce(
    (acc, arr) => acc.flatMap(a => arr.map(b => [...a, b])),
    [[]]
  );
}

// ---------------------------------------------------------------------------
// Kombinations-Schätzung (für UI-Hinweis vor dem Start)
// ---------------------------------------------------------------------------

export function estimateCombos(indicatorCount, maxDepth) {
  let total = 0;
  for (let d = 1; d <= maxDepth; d++) {
    let binom = 1;
    for (let i = 0; i < d; i++) binom = binom * (indicatorCount - i) / (i + 1);
    total += Math.round(binom) * Math.pow(6, d);
  }
  return Math.round(total);
}

// ---------------------------------------------------------------------------
// Haupt-Suchfunktion
// ---------------------------------------------------------------------------

export function runAutoSearch({ bars, selectedIndicators, maxDepth, forwardSteps, minSamples }) {
  const n = bars.length;
  const split = Math.floor(n * 2 / 3);
  const closes = bars.map(b => b.c);

  // Indikatoren auf ALLEN Bars berechnen (korrekte Warm-up-Phase auch für OOS)
  // Schwellenwerte nur aus IS-Anteil ableiten → kein Look-Ahead
  const prepared = selectedIndicators.map(cfg => {
    const def = INDICATOR_REGISTRY[cfg.id];
    const series = def.compute(bars, cfg.params);
    const conds = generateConditions(series.slice(0, split), def);
    return { ...cfg, def, series, conds };
  });

  // Alle Kombinationen aufbauen (Tiefe 1 bis maxDepth)
  const allCombos = [];
  for (let d = 1; d <= maxDepth; d++) {
    for (const grp of getCombinations(prepared, d)) {
      const options = grp.map(ind =>
        ind.conds.map(c => ({
          id: ind.id, params: ind.params,
          indLabel: ind.def.label,
          condLabel: c.label,
          cond: c,
          series: ind.series,
        }))
      );
      for (const combo of cartesian(options)) {
        allCombos.push(combo);
      }
    }
  }

  // Scan auf einem Bereich [from, to)
  function scan(combo, from, to) {
    const hits = [];
    for (let i = from; i < to - forwardSteps; i++) {
      if (combo.every(c => evalCondition(c.series[i], c.cond))) hits.push(i);
    }
    if (!hits.length) return null;
    return computeStats(hits.map(i => ((closes[i + forwardSteps] - closes[i]) / closes[i]) * 100));
  }

  // IS-Scan: alle Kombinationen testen, nach Mindest-Treffern filtern
  const passed = [];
  for (const combo of allCombos) {
    const is = scan(combo, 0, split);
    if (is && is.n >= minSamples) passed.push({ combo, is, oos: null });
  }

  // Top 30 nach IS-Erwartungswert für OOS-Validierung auswählen
  passed.sort((a, b) => b.is.ev - a.is.ev);
  const top = passed.slice(0, 30);

  // OOS-Validierung auf unbekannten Daten
  for (const r of top) r.oos = scan(r.combo, split, n);

  // Finales Ranking nach OOS-Erwartungswert
  top.sort((a, b) => (b.oos?.ev ?? -Infinity) - (a.oos?.ev ?? -Infinity));

  return {
    results: top,
    totalCombos: allCombos.length,
    passed: passed.length,
    split,
    n,
  };
}

// ---------------------------------------------------------------------------
// Bewertung eines Ergebnisses
// ---------------------------------------------------------------------------

export function rate(res) {
  const o = res.oos;
  if (!o) return { label: "–", cls: "badge-neutral" };
  if (o.ev > 0.15 && o.wr > 55 && (o.pf ?? 0) > 1.3) return { label: "⭐⭐⭐ Sehr stark", cls: "badge-strong" };
  if (o.ev > 0.05 && o.wr > 52)                        return { label: "⭐⭐ Interessant", cls: "badge-medium" };
  if (o.ev > 0)                                         return { label: "⭐ Schwach", cls: "badge-weak" };
  return { label: "✗ Versagt", cls: "badge-fail" };
}
