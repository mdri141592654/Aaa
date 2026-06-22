// indicators.js

// ---------------------------------------------------------------------------
// Grundbausteine
// ---------------------------------------------------------------------------

function ema(values, period) {
  const n = values.length;
  const result = new Array(n).fill(null);
  if (n < period) return result;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let prev = sum / period;
  result[period - 1] = prev;
  for (let i = period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

function emaSkipLeadingNulls(values, period) {
  const n = values.length;
  const result = new Array(n).fill(null);
  const start = values.findIndex((v) => v !== null && v !== undefined);
  if (start === -1 || n - start < period) return result;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = start; i < start + period; i++) sum += values[i];
  let prev = sum / period;
  result[start + period - 1] = prev;
  for (let i = start + period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

function rollingHighLow(highs, lows, period) {
  const n = highs.length;
  const hh = new Array(n).fill(null);
  const ll = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let h = -Infinity, l = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (highs[j] > h) h = highs[j];
      if (lows[j] < l) l = lows[j];
    }
    hh[i] = h;
    ll[i] = l;
  }
  return { hh, ll };
}

// ---------------------------------------------------------------------------
// Bestehende Indikatoren
// ---------------------------------------------------------------------------

function calcRSI(bars, { period = 14 } = {}) {
  const closes = bars.map((b) => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  if (n < period + 1) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gainSum += diff; else lossSum -= diff;
  }
  let avgGain = gainSum / period, avgLoss = lossSum / period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < n; i++) {
    const diff = closes[i] - closes[i - 1];
    avgGain = (avgGain * (period - 1) + (diff > 0 ? diff : 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (diff < 0 ? -diff : 0)) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function calcSMI(bars, { kPeriod = 10, d1 = 3, d2 = 3 } = {}) {
  const highs = bars.map((b) => b.h);
  const lows = bars.map((b) => b.l);
  const closes = bars.map((b) => b.c);
  const n = closes.length;
  const { hh, ll } = rollingHighLow(highs, lows, kPeriod);
  const diff = new Array(n).fill(null);
  const range = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hh[i] === null) continue;
    diff[i] = closes[i] - (hh[i] + ll[i]) / 2;
    range[i] = hh[i] - ll[i];
  }
  const smoothDiff = emaSkipLeadingNulls(emaSkipLeadingNulls(diff, d1), d2);
  const smoothRange = emaSkipLeadingNulls(emaSkipLeadingNulls(range, d1), d2);
  const result = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (smoothDiff[i] === null || !smoothRange[i]) continue;
    result[i] = (100 * smoothDiff[i]) / (0.5 * smoothRange[i]);
  }
  return result;
}

function calcRegime(bars, { emaFast = 50, emaSlow = 200 } = {}) {
  const closes = bars.map((b) => b.c);
  const fast = ema(closes, emaFast);
  const slow = ema(closes, emaSlow);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (fast[i] === null || slow[i] === null) continue;
    if (closes[i] > slow[i] && fast[i] > slow[i]) result[i] = "bull";
    else if (closes[i] < slow[i] && fast[i] < slow[i]) result[i] = "bear";
    else result[i] = "neutral";
  }
  return result;
}

// ---------------------------------------------------------------------------
// 18 neue Indikatoren
// ---------------------------------------------------------------------------

function calcMACDHist(bars, { fast = 12, slow = 26, signal = 9 } = {}) {
  const closes = bars.map((b) => b.c);
  const macdLine = ema(closes, fast).map((f, i) => {
    const s = ema(closes, slow)[i];
    return f === null || s === null ? null : f - s;
  });
  const signalLine = emaSkipLeadingNulls(macdLine, signal);
  return macdLine.map((m, i) => m === null || signalLine[i] === null ? null : m - signalLine[i]);
}

function calcMACDRegime(bars, { fast = 12, slow = 26, signal = 9 } = {}) {
  return calcMACDHist(bars, { fast, slow, signal }).map((h) => {
    if (h === null) return null;
    return h > 0 ? "bull" : h < 0 ? "bear" : "neutral";
  });
}

function calcBollingerB(bars, { period = 20, stdMult = 2 } = {}) {
  const closes = bars.map((b) => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const slice = closes.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    result[i] = std === 0 ? 0.5 : (closes[i] - (mean - stdMult * std)) / (2 * stdMult * std);
  }
  return result;
}

function calcATRPct(bars, { period = 14 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  if (n < 2) return result;
  const tr = [bars[0].h - bars[0].l];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i-1].c), Math.abs(bars[i].l - bars[i-1].c)));
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = bars[period-1].c > 0 ? (atr / bars[period-1].c) * 100 : null;
  for (let i = period; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result[i] = bars[i].c > 0 ? (atr / bars[i].c) * 100 : null;
  }
  return result;
}

function calcStochK(bars, { kPeriod = 14, smooth = 3 } = {}) {
  const n = bars.length;
  const rawK = new Array(n).fill(null);
  for (let i = kPeriod - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
    }
    rawK[i] = hi === lo ? 50 : ((bars[i].c - lo) / (hi - lo)) * 100;
  }
  return emaSkipLeadingNulls(rawK, smooth);
}

function calcStochD(bars, { kPeriod = 14, smooth = 3, dSmooth = 3 } = {}) {
  return emaSkipLeadingNulls(calcStochK(bars, { kPeriod, smooth }), dSmooth);
}

function calcCCI(bars, { period = 20 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const tp = bars.slice(i - period + 1, i + 1).map((b) => (b.h + b.l + b.c) / 3);
    const mean = tp.reduce((a, b) => a + b, 0) / period;
    const mad = tp.reduce((a, b) => a + Math.abs(b - mean), 0) / period;
    result[i] = mad === 0 ? 0 : (tp[tp.length - 1] - mean) / (0.015 * mad);
  }
  return result;
}

function calcWilliamsR(bars, { period = 14 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
    }
    result[i] = hi === lo ? -50 : ((hi - bars[i].c) / (hi - lo)) * -100;
  }
  return result;
}

function calcADX(bars, { period = 14 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  if (n < period * 2) return result;
  const tr = [], pdm = [], mdm = [];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i-1].c), Math.abs(bars[i].l - bars[i-1].c)));
    const up = bars[i].h - bars[i-1].h, dn = bars[i-1].l - bars[i].l;
    pdm.push(up > dn && up > 0 ? up : 0);
    mdm.push(dn > up && dn > 0 ? dn : 0);
  }
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0);
  let sp = pdm.slice(0, period).reduce((a, b) => a + b, 0);
  let sm = mdm.slice(0, period).reduce((a, b) => a + b, 0);
  const dxArr = [];
  const pushDX = () => {
    const pdi = atr > 0 ? sp / atr * 100 : 0;
    const mdi = atr > 0 ? sm / atr * 100 : 0;
    const s = pdi + mdi;
    dxArr.push(s > 0 ? Math.abs(pdi - mdi) / s * 100 : 0);
  };
  pushDX();
  for (let i = period; i < tr.length; i++) {
    atr = atr - atr / period + tr[i];
    sp = sp - sp / period + pdm[i];
    sm = sm - sm / period + mdm[i];
    pushDX();
  }
  let adx = dxArr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period * 2 - 1] = adx;
  for (let i = period; i < dxArr.length; i++) {
    adx = (adx * (period - 1) + dxArr[i]) / period;
    result[period + i] = adx;
  }
  return result;
}

function calcROC(bars, { period = 10 } = {}) {
  const closes = bars.map((b) => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    result[i] = closes[i - period] !== 0 ? ((closes[i] - closes[i - period]) / closes[i - period]) * 100 : null;
  }
  return result;
}

function calcMomentum(bars, { period = 10 } = {}) {
  const closes = bars.map((b) => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) result[i] = closes[i] - closes[i - period];
  return result;
}

function calcParabolicSAR(bars, { step = 0.02, max = 0.2 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  if (n < 2) return result;
  let bull = true, sar = bars[0].l, ep = bars[0].h, af = step;
  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (bull) {
      sar = Math.min(sar, bars[Math.max(0, i - 1)].l, bars[Math.max(0, i - 2)].l);
      if (bars[i].l < sar) { bull = false; sar = ep; ep = bars[i].l; af = step; }
      else if (bars[i].h > ep) { ep = bars[i].h; af = Math.min(af + step, max); }
    } else {
      sar = Math.max(sar, bars[Math.max(0, i - 1)].h, bars[Math.max(0, i - 2)].h);
      if (bars[i].h > sar) { bull = true; sar = ep; ep = bars[i].h; af = step; }
      else if (bars[i].l < ep) { ep = bars[i].l; af = Math.min(af + step, max); }
    }
    result[i] = bull ? "bull" : "bear";
  }
  return result;
}

function calcAroon(bars, { period = 25 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let hiIdx = i, loIdx = i;
    for (let j = i - period; j <= i; j++) {
      if (bars[j].h >= bars[hiIdx].h) hiIdx = j;
      if (bars[j].l <= bars[loIdx].l) loIdx = j;
    }
    result[i] = ((period - (i - hiIdx)) / period - (period - (i - loIdx)) / period) * 100;
  }
  return result;
}

function calcCMO(bars, { period = 14 } = {}) {
  const closes = bars.map((b) => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let up = 0, dn = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - closes[j - 1];
      if (d > 0) up += d; else dn -= d;
    }
    result[i] = up + dn === 0 ? 0 : ((up - dn) / (up + dn)) * 100;
  }
  return result;
}

function calcDeMarker(bars, { period = 14 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  const deMax = new Array(n).fill(0);
  const deMin = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    deMax[i] = Math.max(0, bars[i].h - bars[i - 1].h);
    deMin[i] = Math.max(0, bars[i - 1].l - bars[i].l);
  }
  for (let i = period; i < n; i++) {
    let sm = 0, sl = 0;
    for (let j = i - period + 1; j <= i; j++) { sm += deMax[j]; sl += deMin[j]; }
    result[i] = sm + sl === 0 ? 0.5 : sm / (sm + sl);
  }
  return result;
}

function calcElderBull(bars, { period = 13 } = {}) {
  const emaLine = ema(bars.map((b) => b.c), period);
  return bars.map((b, i) => emaLine[i] === null ? null : b.h - emaLine[i]);
}

function calcElderBear(bars, { period = 13 } = {}) {
  const emaLine = ema(bars.map((b) => b.c), period);
  return bars.map((b, i) => emaLine[i] === null ? null : b.l - emaLine[i]);
}

function calcEMADist(bars, { period = 50 } = {}) {
  const closes = bars.map((b) => b.c);
  const emaLine = ema(closes, period);
  return closes.map((c, i) => emaLine[i] === null ? null : ((c - emaLine[i]) / emaLine[i]) * 100);
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const INDICATOR_REGISTRY = {
  regime: {
    id: "regime", label: "Regime (Trend)",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull" }, { value: "neutral", label: "Neutral" }, { value: "bear", label: "Bear" }],
    params: [
      { key: "emaFast", label: "EMA schnell", type: "number", default: 50, min: 2, max: 400 },
      { key: "emaSlow", label: "EMA langsam", type: "number", default: 200, min: 2, max: 400 },
    ],
    compute: calcRegime,
  },
  rsi: {
    id: "rsi", label: "RSI",
    valueType: "numeric", range: [0, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcRSI,
  },
  smi: {
    id: "smi", label: "SMI (Stochastic Momentum)",
    valueType: "numeric", range: [-100, 100],
    params: [
      { key: "kPeriod", label: "%K Periode", type: "number", default: 10, min: 2, max: 100 },
      { key: "d1", label: "EMA 1", type: "number", default: 3, min: 1, max: 50 },
      { key: "d2", label: "EMA 2", type: "number", default: 3, min: 1, max: 50 },
    ],
    compute: calcSMI,
  },
  macdHist: {
    id: "macdHist", label: "MACD Histogramm",
    valueType: "numeric", range: [-0.01, 0.01],
    params: [
      { key: "fast", label: "Schnell", type: "number", default: 12, min: 2, max: 100 },
      { key: "slow", label: "Langsam", type: "number", default: 26, min: 2, max: 200 },
      { key: "signal", label: "Signal", type: "number", default: 9, min: 1, max: 50 },
    ],
    compute: calcMACDHist,
  },
  macdRegime: {
    id: "macdRegime", label: "MACD Regime",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull (Hist > 0)" }, { value: "neutral", label: "Neutral" }, { value: "bear", label: "Bear (Hist < 0)" }],
    params: [
      { key: "fast", label: "Schnell", type: "number", default: 12, min: 2, max: 100 },
      { key: "slow", label: "Langsam", type: "number", default: 26, min: 2, max: 200 },
      { key: "signal", label: "Signal", type: "number", default: 9, min: 1, max: 50 },
    ],
    compute: calcMACDRegime,
  },
  bollingerB: {
    id: "bollingerB", label: "Bollinger %B",
    valueType: "numeric", range: [0, 1],
    params: [
      { key: "period", label: "Periode", type: "number", default: 20, min: 2, max: 200 },
      { key: "stdMult", label: "Std-Faktor", type: "number", default: 2, min: 1, max: 5 },
    ],
    compute: calcBollingerB,
  },
  atrPct: {
    id: "atrPct", label: "ATR %",
    valueType: "numeric", range: [0, 5],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcATRPct,
  },
  stochK: {
    id: "stochK", label: "Stochastic %K",
    valueType: "numeric", range: [0, 100],
    params: [
      { key: "kPeriod", label: "%K Periode", type: "number", default: 14, min: 2, max: 100 },
      { key: "smooth", label: "Glättung", type: "number", default: 3, min: 1, max: 20 },
    ],
    compute: calcStochK,
  },
  stochD: {
    id: "stochD", label: "Stochastic %D",
    valueType: "numeric", range: [0, 100],
    params: [
      { key: "kPeriod", label: "%K Periode", type: "number", default: 14, min: 2, max: 100 },
      { key: "smooth", label: "%K Glättung", type: "number", default: 3, min: 1, max: 20 },
      { key: "dSmooth", label: "%D Glättung", type: "number", default: 3, min: 1, max: 20 },
    ],
    compute: calcStochD,
  },
  cci: {
    id: "cci", label: "CCI (Commodity Channel Index)",
    valueType: "numeric", range: [-300, 300],
    params: [{ key: "period", label: "Periode", type: "number", default: 20, min: 2, max: 200 }],
    compute: calcCCI,
  },
  williamsR: {
    id: "williamsR", label: "Williams %R",
    valueType: "numeric", range: [-100, 0],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcWilliamsR,
  },
  adx: {
    id: "adx", label: "ADX (Trendstärke)",
    valueType: "numeric", range: [0, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcADX,
  },
  roc: {
    id: "roc", label: "ROC (Rate of Change %)",
    valueType: "numeric", range: [-20, 20],
    params: [{ key: "period", label: "Periode", type: "number", default: 10, min: 1, max: 200 }],
    compute: calcROC,
  },
  momentum: {
    id: "momentum", label: "Momentum",
    valueType: "numeric", range: [-0.05, 0.05],
    params: [{ key: "period", label: "Periode", type: "number", default: 10, min: 1, max: 200 }],
    compute: calcMomentum,
  },
  parabolicSAR: {
    id: "parabolicSAR", label: "Parabolic SAR",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull (Kurs > SAR)" }, { value: "bear", label: "Bear (Kurs < SAR)" }],
    params: [
      { key: "step", label: "Schrittweite (×100)", type: "number", default: 2, min: 1, max: 10 },
      { key: "max", label: "Maximum (×10)", type: "number", default: 2, min: 1, max: 10 },
    ],
    compute: (bars, { step = 2, max = 2 } = {}) => calcParabolicSAR(bars, { step: step / 100, max: max / 10 }),
  },
  aroon: {
    id: "aroon", label: "Aroon Oszillator",
    valueType: "numeric", range: [-100, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 25, min: 2, max: 200 }],
    compute: calcAroon,
  },
  cmo: {
    id: "cmo", label: "CMO (Chande Momentum)",
    valueType: "numeric", range: [-100, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcCMO,
  },
  deMarker: {
    id: "deMarker", label: "DeMarker",
    valueType: "numeric", range: [0, 1],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcDeMarker,
  },
  elderBull: {
    id: "elderBull", label: "Elder Ray – Bull Power",
    valueType: "numeric", range: [-0.01, 0.01],
    params: [{ key: "period", label: "EMA Periode", type: "number", default: 13, min: 2, max: 100 }],
    compute: calcElderBull,
  },
  elderBear: {
    id: "elderBear", label: "Elder Ray – Bear Power",
    valueType: "numeric", range: [-0.01, 0.01],
    params: [{ key: "period", label: "EMA Periode", type: "number", default: 13, min: 2, max: 100 }],
    compute: calcElderBear,
  },
  emaDist: {
    id: "emaDist", label: "EMA Abstand %",
    valueType: "numeric", range: [-10, 10],
    params: [{ key: "period", label: "EMA Periode", type: "number", default: 50, min: 2, max: 400 }],
    compute: calcEMADist,
  },
};

// ---------------------------------------------------------------------------
// Condition-Auswertung
// ---------------------------------------------------------------------------

export function evalCondition(value, condition) {
  if (value === null || value === undefined) return false;
  switch (condition.op) {
    case "eq": return value === condition.value;
    case "gte": return value >= condition.value;
    case "lte": return value <= condition.value;
    case "gt": return value > condition.value;
    case "lt": return value < condition.value;
    case "between": return value >= condition.value && value <= condition.value2;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// Scan-Engine
// ---------------------------------------------------------------------------

export function runScan(bars, indicatorConfigs, forwardSteps = 20) {
  const closes = bars.map((b) => b.c);
  const n = bars.length;

  const seriesList = indicatorConfigs.map((cfg) => INDICATOR_REGISTRY[cfg.id].compute(bars, cfg.params));

  const matchIdx = [];
  for (let i = 0; i < n; i++) {
    let allOk = true;
    for (let k = 0; k < indicatorConfigs.length; k++) {
      if (!evalCondition(seriesList[k][i], indicatorConfigs[k].condition)) { allOk = false; break; }
    }
    if (allOk) matchIdx.push(i);
  }

  const complete = matchIdx.filter((i) => i + forwardSteps < n);
  const open = matchIdx.filter((i) => i + forwardSteps >= n);

  const sums = new Array(forwardSteps + 1).fill(0);
  const sumsSq = new Array(forwardSteps + 1).fill(0);
  const paths = [];
  const finalReturns = [];

  for (const i of complete) {
    const base = closes[i];
    const path = [0];
    for (let s = 1; s <= forwardSteps; s++) {
      const ret = ((closes[i + s] - base) / base) * 100;
      sums[s] += ret;
      sumsSq[s] += ret * ret;
      path.push(ret);
    }
    paths.push(path);
    finalReturns.push(((closes[i + forwardSteps] - base) / base) * 100);
  }

  const count = complete.length;
  const avgPath = sums.map((s) => (count > 0 ? s / count : null));
  const stdPath = sumsSq.map((sq, s) =>
    count > 0 ? Math.sqrt(Math.max(sq / count - avgPath[s] * avgPath[s], 0)) : null
  );

  let winRate = null, median = null, maxGain = null, maxLoss = null;
  let profitFactor = null, expectedValue = null;

  if (count > 0) {
    const wins = finalReturns.filter((r) => r > 0);
    const losses = finalReturns.filter((r) => r < 0);
    winRate = (wins.length / count) * 100;

    const sorted = [...finalReturns].sort((a, b) => a - b);
    median = count % 2 === 0
      ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
      : sorted[Math.floor(count / 2)];
    maxGain = sorted[count - 1];
    maxLoss = sorted[0];

    const grossProfit = wins.reduce((a, b) => a + b, 0);
    const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
    profitFactor = grossLoss === 0 ? null : grossProfit / grossLoss;

    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLossAmt = losses.length > 0 ? grossLoss / losses.length : 0;
    expectedValue = (winRate / 100) * avgWin - ((100 - winRate) / 100) * avgLossAmt;
  }

  return {
    totalBars: n, sampleSize: count,
    avgPath, stdPath, winRate,
    paths,
    matchDates: complete.map((i) => bars[i].t),
    openSignals: open.map((i) => bars[i].t),
    median, maxGain, maxLoss, profitFactor, expectedValue,
  };
}
