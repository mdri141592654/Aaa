// today_scan.js
// Liest aktuelle Indikatorwerte der letzten Kerze und sucht historisch
// nach ähnlichen Situationen.
import { INDICATOR_REGISTRY, evalCondition } from "./indicators.js";

// Toleranz für numerische Indikatoren: 8 % des Wertebereichs
export function defaultTolerance(def, currentValue) {
  if (def.range) return Math.abs(def.range[1] - def.range[0]) * 0.08;
  return Math.max(0.5, Math.abs(currentValue ?? 0) * 0.08);
}

// Aktuelle Werte (letzte Kerze) für gewählte Indikatoren berechnen
export function computeCurrentValues(bars, selectedIndicators) {
  const last = bars.length - 1;
  return selectedIndicators.map(cfg => {
    const def = INDICATOR_REGISTRY[cfg.id];
    const series = def.compute(bars, cfg.params);
    return { id: cfg.id, params: cfg.params, def, currentValue: series[last], series };
  });
}

// Historischen Scan mit den aktuellen Werten als Bedingungen
export function runTodayScan({ bars, indicatorResults, tolerances, forwardSteps }) {
  const closes = bars.map(b => b.c);
  const n = bars.length;

  // Bedingungen ableiten
  const conds = indicatorResults.map((ir, k) => {
    const v = ir.currentValue;
    if (v === null || v === undefined)
      return { series: ir.series, condition: null, label: `${ir.def.label}: kein Wert` };
    if (ir.def.valueType === "category")
      return { series: ir.series, condition: { op: "eq", value: v },
               label: `${ir.def.label} = ${v}` };
    const tol = tolerances[k] ?? defaultTolerance(ir.def, v);
    return {
      series: ir.series,
      condition: { op: "between", value: v - tol, value2: v + tol },
      label: `${ir.def.label}: ${v.toFixed(2)} ± ${tol.toFixed(2)}`,
    };
  });

  // Historische Treffer suchen (nur Bars mit vollständiger Forward-Historie)
  const matchIdx = [];
  for (let i = 0; i < n - forwardSteps; i++) {
    if (conds.every(c => c.condition && evalCondition(c.series[i], c.condition)))
      matchIdx.push(i);
  }

  const count = matchIdx.length;
  const sums = new Array(forwardSteps + 1).fill(0);
  const sumsSq = new Array(forwardSteps + 1).fill(0);
  const paths = [], finalReturns = [];

  for (const i of matchIdx) {
    const base = closes[i], path = [0];
    for (let s = 1; s <= forwardSteps; s++) {
      const ret = ((closes[i + s] - base) / base) * 100;
      sums[s] += ret; sumsSq[s] += ret * ret; path.push(ret);
    }
    paths.push(path);
    finalReturns.push(((closes[i + forwardSteps] - base) / base) * 100);
  }

  const avgPath = sums.map(s => count > 0 ? s / count : null);
  const stdPath = sumsSq.map((sq, s) =>
    count > 0 ? Math.sqrt(Math.max(sq / count - avgPath[s] * avgPath[s], 0)) : null);

  let winRate = null, median = null, maxGain = null, maxLoss = null,
      profitFactor = null, expectedValue = null;
  if (count > 0) {
    const wins   = finalReturns.filter(r => r > 0);
    const losses = finalReturns.filter(r => r < 0);
    const gp = wins.reduce((a, b) => a + b, 0);
    const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
    winRate = (wins.length / count) * 100;
    const sorted = [...finalReturns].sort((a, b) => a - b);
    median  = count % 2 === 0
      ? (sorted[count/2-1] + sorted[count/2]) / 2
      : sorted[Math.floor(count/2)];
    maxGain = sorted[count - 1]; maxLoss = sorted[0];
    profitFactor = gl === 0 ? null : gp / gl;
    const aw = wins.length   > 0 ? gp / wins.length   : 0;
    const al = losses.length > 0 ? gl / losses.length : 0;
    expectedValue = (winRate / 100) * aw - ((100 - winRate) / 100) * al;
  }

  return {
    totalBars: n, sampleSize: count, avgPath, stdPath, winRate, paths,
    matchDates: matchIdx.map(i => bars[i].t),
    median, maxGain, maxLoss, profitFactor, expectedValue,
    conditionLabels: conds.map(c => c.label),
  };
}
