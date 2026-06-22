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
  const start = values.findIndex(v => v !== null && v !== undefined);
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
    hh[i] = h; ll[i] = l;
  }
  return { hh, ll };
}

function rollingATR(bars, period) {
  const n = bars.length;
  if (n < period) return new Array(n).fill(null);
  const tr = [bars[0].h - bars[0].l];
  for (let i = 1; i < n; i++) {
    tr.push(Math.max(
      bars[i].h - bars[i].l,
      Math.abs(bars[i].h - bars[i-1].c),
      Math.abs(bars[i].l - bars[i-1].c)
    ));
  }
  const result = new Array(n).fill(null);
  let atr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result[period - 1] = atr;
  for (let i = period; i < n; i++) {
    atr = (atr * (period - 1) + tr[i]) / period;
    result[i] = atr;
  }
  return result;
}

// ---------------------------------------------------------------------------
// Bestehende 21 Indikatoren
// ---------------------------------------------------------------------------

function calcRSI(bars, { period = 14 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  if (n < period + 1) return result;
  let gainSum = 0, lossSum = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i-1];
    if (d >= 0) gainSum += d; else lossSum -= d;
  }
  let ag = gainSum / period, al = lossSum / period;
  result[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < n; i++) {
    const d = closes[i] - closes[i-1];
    ag = (ag * (period - 1) + (d > 0 ? d : 0)) / period;
    al = (al * (period - 1) + (d < 0 ? -d : 0)) / period;
    result[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return result;
}

function calcSMI(bars, { kPeriod = 10, d1 = 3, d2 = 3 } = {}) {
  const highs = bars.map(b => b.h), lows = bars.map(b => b.l), closes = bars.map(b => b.c);
  const n = closes.length;
  const { hh, ll } = rollingHighLow(highs, lows, kPeriod);
  const diff = new Array(n).fill(null), range = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (hh[i] === null) continue;
    diff[i] = closes[i] - (hh[i] + ll[i]) / 2;
    range[i] = hh[i] - ll[i];
  }
  const sd = emaSkipLeadingNulls(emaSkipLeadingNulls(diff, d1), d2);
  const sr = emaSkipLeadingNulls(emaSkipLeadingNulls(range, d1), d2);
  const result = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    if (sd[i] === null || !sr[i]) continue;
    result[i] = (100 * sd[i]) / (0.5 * sr[i]);
  }
  return result;
}

function calcRegime(bars, { emaFast = 50, emaSlow = 200 } = {}) {
  const closes = bars.map(b => b.c);
  const fast = ema(closes, emaFast), slow = ema(closes, emaSlow);
  return closes.map((c, i) => {
    if (fast[i] === null || slow[i] === null) return null;
    if (c > slow[i] && fast[i] > slow[i]) return "bull";
    if (c < slow[i] && fast[i] < slow[i]) return "bear";
    return "neutral";
  });
}

function calcMACDHist(bars, { fast = 12, slow = 26, signal = 9 } = {}) {
  const closes = bars.map(b => b.c);
  const f = ema(closes, fast), s = ema(closes, slow);
  const macd = f.map((v, i) => v === null || s[i] === null ? null : v - s[i]);
  const sig = emaSkipLeadingNulls(macd, signal);
  return macd.map((m, i) => m === null || sig[i] === null ? null : m - sig[i]);
}

function calcMACDRegime(bars, { fast = 12, slow = 26, signal = 9 } = {}) {
  return calcMACDHist(bars, { fast, slow, signal }).map(h =>
    h === null ? null : h > 0 ? "bull" : h < 0 ? "bear" : "neutral"
  );
}

function calcBollingerB(bars, { period = 20, stdMult = 2 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const sl = closes.slice(i - period + 1, i + 1);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    result[i] = std === 0 ? 0.5 : (closes[i] - (mean - stdMult * std)) / (2 * stdMult * std);
  }
  return result;
}

function calcATRPct(bars, { period = 14 } = {}) {
  const atr = rollingATR(bars, period);
  return atr.map((v, i) => v === null || bars[i].c === 0 ? null : (v / bars[i].c) * 100);
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
    const tp = bars.slice(i - period + 1, i + 1).map(b => (b.h + b.l + b.c) / 3);
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
    const pdi = atr > 0 ? sp / atr * 100 : 0, mdi = atr > 0 ? sm / atr * 100 : 0;
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
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++)
    result[i] = closes[i-period] !== 0 ? ((closes[i] - closes[i-period]) / closes[i-period]) * 100 : null;
  return result;
}

function calcMomentum(bars, { period = 10 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) result[i] = closes[i] - closes[i - period];
  return result;
}

function calcParabolicSAR(bars, { step = 2, max = 2 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  if (n < 2) return result;
  const sv = step / 100, mv = max / 10;
  let bull = true, sar = bars[0].l, ep = bars[0].h, af = sv;
  for (let i = 1; i < n; i++) {
    sar = sar + af * (ep - sar);
    if (bull) {
      sar = Math.min(sar, bars[Math.max(0, i-1)].l, bars[Math.max(0, i-2)].l);
      if (bars[i].l < sar) { bull = false; sar = ep; ep = bars[i].l; af = sv; }
      else if (bars[i].h > ep) { ep = bars[i].h; af = Math.min(af + sv, mv); }
    } else {
      sar = Math.max(sar, bars[Math.max(0, i-1)].h, bars[Math.max(0, i-2)].h);
      if (bars[i].h > sar) { bull = true; sar = ep; ep = bars[i].h; af = sv; }
      else if (bars[i].l < ep) { ep = bars[i].l; af = Math.min(af + sv, mv); }
    }
    result[i] = bull ? "bull" : "bear";
  }
  return result;
}

function calcAroon(bars, { period = 25 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let hi = i, lo = i;
    for (let j = i - period; j <= i; j++) {
      if (bars[j].h >= bars[hi].h) hi = j;
      if (bars[j].l <= bars[lo].l) lo = j;
    }
    result[i] = ((period - (i - hi)) / period - (period - (i - lo)) / period) * 100;
  }
  return result;
}

function calcCMO(bars, { period = 14 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    let up = 0, dn = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const d = closes[j] - closes[j-1];
      if (d > 0) up += d; else dn -= d;
    }
    result[i] = up + dn === 0 ? 0 : ((up - dn) / (up + dn)) * 100;
  }
  return result;
}

function calcDeMarker(bars, { period = 14 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  const dMax = new Array(n).fill(0), dMin = new Array(n).fill(0);
  for (let i = 1; i < n; i++) {
    dMax[i] = Math.max(0, bars[i].h - bars[i-1].h);
    dMin[i] = Math.max(0, bars[i-1].l - bars[i].l);
  }
  for (let i = period; i < n; i++) {
    let sm = 0, sl = 0;
    for (let j = i - period + 1; j <= i; j++) { sm += dMax[j]; sl += dMin[j]; }
    result[i] = sm + sl === 0 ? 0.5 : sm / (sm + sl);
  }
  return result;
}

function calcElderBull(bars, { period = 13 } = {}) {
  const el = ema(bars.map(b => b.c), period);
  return bars.map((b, i) => el[i] === null ? null : b.h - el[i]);
}

function calcElderBear(bars, { period = 13 } = {}) {
  const el = ema(bars.map(b => b.c), period);
  return bars.map((b, i) => el[i] === null ? null : b.l - el[i]);
}

function calcEMADist(bars, { period = 50 } = {}) {
  const closes = bars.map(b => b.c);
  const el = ema(closes, period);
  return closes.map((c, i) => el[i] === null || el[i] === 0 ? null : ((c - el[i]) / el[i]) * 100);
}

// ---------------------------------------------------------------------------
// 25 neue Indikatoren
// ---------------------------------------------------------------------------

// 1. SMA Abstand %
function calcSMADist(bars, { period = 50 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const sma = closes.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0) / period;
    result[i] = sma !== 0 ? ((closes[i] - sma) / sma) * 100 : null;
  }
  return result;
}

// 2. SMA Kreuz Regime
function calcSMARegime(bars, { fast = 50, slow = 200 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const sma = p => {
    const r = new Array(n).fill(null);
    for (let i = p - 1; i < n; i++) r[i] = closes.slice(i - p + 1, i + 1).reduce((a, b) => a + b, 0) / p;
    return r;
  };
  const f = sma(fast), s = sma(slow);
  return closes.map((c, i) => {
    if (f[i] === null || s[i] === null) return null;
    if (c > s[i] && f[i] > s[i]) return "bull";
    if (c < s[i] && f[i] < s[i]) return "bear";
    return "neutral";
  });
}

// 3. Donchian Kanal %
function calcDonchianB(bars, { period = 20 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
    }
    result[i] = hi === lo ? 0.5 : (bars[i].c - lo) / (hi - lo);
  }
  return result;
}

// 4. Keltner Kanal %
function calcKeltnerB(bars, { period = 20, atrMult = 2, atrPeriod = 14 } = {}) {
  const closes = bars.map(b => b.c);
  const mid = ema(closes, period);
  const atr = rollingATR(bars, atrPeriod);
  return closes.map((c, i) => {
    if (mid[i] === null || atr[i] === null) return null;
    const upper = mid[i] + atrMult * atr[i];
    const lower = mid[i] - atrMult * atr[i];
    return upper === lower ? 0.5 : (c - lower) / (upper - lower);
  });
}

// 5. Ichimoku Regime (Tenkan/Kijun)
function calcIchimokuRegime(bars, { tenkan = 9, kijun = 26 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  const mid = (from, to) => {
    let hi = -Infinity, lo = Infinity;
    for (let j = from; j <= to; j++) {
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
    }
    return (hi + lo) / 2;
  };
  for (let i = kijun - 1; i < n; i++) {
    const tk = mid(i - tenkan + 1, i), kj = mid(i - kijun + 1, i), c = bars[i].c;
    if (c > tk && tk > kj) result[i] = "bull";
    else if (c < tk && tk < kj) result[i] = "bear";
    else result[i] = "neutral";
  }
  return result;
}

// 6. TRIX
function calcTRIX(bars, { period = 14 } = {}) {
  const closes = bars.map(b => b.c);
  const e3 = emaSkipLeadingNulls(emaSkipLeadingNulls(ema(closes, period), period), period);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    if (e3[i] === null || e3[i-1] === null || e3[i-1] === 0) continue;
    result[i] = ((e3[i] - e3[i-1]) / e3[i-1]) * 100;
  }
  return result;
}

// 7. Ultimate Oscillator
function calcUltimateOsc(bars, { p1 = 7, p2 = 14, p3 = 28 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  const bp = [], tr = [];
  for (let i = 1; i < n; i++) {
    const pc = bars[i-1].c;
    bp.push(bars[i].c - Math.min(bars[i].l, pc));
    tr.push(Math.max(bars[i].h, pc) - Math.min(bars[i].l, pc));
  }
  const raw = (end, p) => {
    let s = 0, t = 0;
    for (let j = end - p + 1; j <= end; j++) { s += bp[j]; t += tr[j]; }
    return t === 0 ? 0 : s / t;
  };
  for (let i = p3 - 1; i < bp.length; i++)
    result[i + 1] = ((4 * raw(i, p1) + 2 * raw(i, p2) + raw(i, p3)) / 7) * 100;
  return result;
}

// 8. PPO (Percentage Price Oscillator)
function calcPPO(bars, { fast = 12, slow = 26 } = {}) {
  const closes = bars.map(b => b.c);
  const f = ema(closes, fast), s = ema(closes, slow);
  return f.map((v, i) => v === null || s[i] === null || s[i] === 0 ? null : ((v - s[i]) / s[i]) * 100);
}

// 9. Linear Regression Slope (normiert %)
function calcLRSlope(bars, { period = 14 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  const xm = (period - 1) / 2;
  const xd = Array.from({length: period}, (_, j) => (j - xm) ** 2).reduce((a, b) => a + b, 0);
  for (let i = period - 1; i < n; i++) {
    const sl = closes.slice(i - period + 1, i + 1);
    const ym = sl.reduce((a, b) => a + b, 0) / period;
    let num = 0;
    for (let j = 0; j < period; j++) num += (j - xm) * (sl[j] - ym);
    result[i] = closes[i] !== 0 ? (num / xd / closes[i]) * 100 : null;
  }
  return result;
}

// 10. Rollende Std-Abweichung %
function calcRollingStdDev(bars, { period = 20 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const sl = closes.slice(i - period + 1, i + 1);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    result[i] = closes[i] !== 0 ? (std / closes[i]) * 100 : null;
  }
  return result;
}

// 11. Hull Moving Average Regime
function calcHMA(values, period) {
  const half = Math.max(2, Math.floor(period / 2));
  const sqrtP = Math.max(2, Math.round(Math.sqrt(period)));
  const e1 = ema(values, half), e2 = ema(values, period);
  const diff = e1.map((v, i) => v === null || e2[i] === null ? null : 2 * v - e2[i]);
  return emaSkipLeadingNulls(diff, sqrtP);
}

function calcHMARegime(bars, { period = 20 } = {}) {
  const closes = bars.map(b => b.c);
  const hma = calcHMA(closes, period);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    if (hma[i] === null || hma[i-1] === null) continue;
    if (closes[i] > hma[i] && hma[i] > hma[i-1]) result[i] = "bull";
    else if (closes[i] < hma[i] && hma[i] < hma[i-1]) result[i] = "bear";
    else result[i] = "neutral";
  }
  return result;
}

// 12. DEMA Abstand %
function calcDEMADist(bars, { period = 21 } = {}) {
  const closes = bars.map(b => b.c);
  const e1 = ema(closes, period), e2 = emaSkipLeadingNulls(e1, period);
  const dema = e1.map((v, i) => v === null || e2[i] === null ? null : 2 * v - e2[i]);
  return closes.map((c, i) => dema[i] === null || dema[i] === 0 ? null : ((c - dema[i]) / dema[i]) * 100);
}

// 13. TEMA Abstand %
function calcTEMADist(bars, { period = 21 } = {}) {
  const closes = bars.map(b => b.c);
  const e1 = ema(closes, period);
  const e2 = emaSkipLeadingNulls(e1, period);
  const e3 = emaSkipLeadingNulls(e2, period);
  const tema = e1.map((v, i) => {
    if (v === null || e2[i] === null || e3[i] === null) return null;
    return 3 * v - 3 * e2[i] + e3[i];
  });
  return closes.map((c, i) => tema[i] === null || tema[i] === 0 ? null : ((c - tema[i]) / tema[i]) * 100);
}

// 14. Z-Score
function calcZScore(bars, { period = 20 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    const sl = closes.slice(i - period + 1, i + 1);
    const mean = sl.reduce((a, b) => a + b, 0) / period;
    const std = Math.sqrt(sl.reduce((a, b) => a + (b - mean) ** 2, 0) / period);
    result[i] = std === 0 ? 0 : (closes[i] - mean) / std;
  }
  return result;
}

// 15. Choppiness Index
function calcChoppiness(bars, { period = 14 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  const tr = [bars[0].h - bars[0].l];
  for (let i = 1; i < n; i++)
    tr.push(Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i-1].c), Math.abs(bars[i].l - bars[i-1].c)));
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity, atrSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
      atrSum += tr[j];
    }
    const range = hi - lo;
    result[i] = range === 0 ? null : (Math.log10(atrSum / range) / Math.log10(period)) * 100;
  }
  return result;
}

// 16. Vortex Oszillator (VI+ − VI−)
function calcVortex(bars, { period = 14 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  if (n < 2) return result;
  for (let i = period; i < n; i++) {
    let vmp = 0, vmm = 0, trSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      vmp += Math.abs(bars[j].h - bars[j-1].l);
      vmm += Math.abs(bars[j].l - bars[j-1].h);
      trSum += Math.max(bars[j].h - bars[j].l, Math.abs(bars[j].h - bars[j-1].c), Math.abs(bars[j].l - bars[j-1].c));
    }
    if (trSum === 0) continue;
    result[i] = (vmp / trSum - vmm / trSum) * 100;
  }
  return result;
}

// 17. Mass Index
function calcMassIndex(bars, { fast = 9, slow = 25 } = {}) {
  const n = bars.length;
  const hl = bars.map(b => b.h - b.l);
  const e1 = ema(hl, fast), e2 = emaSkipLeadingNulls(e1, fast);
  const ratio = e1.map((v, i) => v === null || e2[i] === null || e2[i] === 0 ? null : v / e2[i]);
  const result = new Array(n).fill(null);
  const start = ratio.findIndex(v => v !== null);
  if (start === -1) return result;
  for (let i = start + slow - 1; i < n; i++) {
    let sum = 0, ok = true;
    for (let j = i - slow + 1; j <= i; j++) {
      if (ratio[j] === null) { ok = false; break; }
      sum += ratio[j];
    }
    if (ok) result[i] = sum;
  }
  return result;
}

// 18. KST (Know Sure Thing)
function calcKST(bars, { r1 = 10, r2 = 13, r3 = 14, r4 = 15 } = {}) {
  const closes = bars.map(b => b.c);
  const roc = p => closes.map((c, i) => i < p || closes[i-p] === 0 ? null : ((c - closes[i-p]) / closes[i-p]) * 100);
  const rc1 = emaSkipLeadingNulls(roc(r1), 10);
  const rc2 = emaSkipLeadingNulls(roc(r2), 13);
  const rc3 = emaSkipLeadingNulls(roc(r3), 15);
  const rc4 = emaSkipLeadingNulls(roc(r4), 20);
  return rc1.map((v, i) => {
    if (v === null || rc2[i] === null || rc3[i] === null || rc4[i] === null) return null;
    return v + rc2[i] * 2 + rc3[i] * 3 + rc4[i] * 4;
  });
}

// 19. Coppock Curve
function calcCoppock(bars, { wmaP = 10, longROC = 14, shortROC = 11 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const mx = Math.max(longROC, shortROC);
  const rocSum = closes.map((c, i) => {
    if (i < mx || closes[i-longROC] === 0 || closes[i-shortROC] === 0) return null;
    return ((c - closes[i-longROC]) / closes[i-longROC] + (c - closes[i-shortROC]) / closes[i-shortROC]) * 100;
  });
  const result = new Array(n).fill(null);
  const weights = Array.from({length: wmaP}, (_, i) => i + 1);
  const wSum = weights.reduce((a, b) => a + b, 0);
  const start = rocSum.findIndex(v => v !== null);
  if (start === -1) return result;
  for (let i = start + wmaP - 1; i < n; i++) {
    let sum = 0, ok = true;
    for (let j = 0; j < wmaP; j++) {
      if (rocSum[i - wmaP + 1 + j] === null) { ok = false; break; }
      sum += rocSum[i - wmaP + 1 + j] * weights[j];
    }
    if (ok) result[i] = sum / wSum;
  }
  return result;
}

// 20. Fisher Transform
function calcFisher(bars, { period = 10 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (bars[j].h > hi) hi = bars[j].h;
      if (bars[j].l < lo) lo = bars[j].l;
    }
    if (hi === lo) continue;
    const val = Math.max(Math.min(2 * ((bars[i].c - lo) / (hi - lo)) - 1, 0.999), -0.999);
    result[i] = 0.5 * Math.log((1 + val) / (1 - val));
  }
  return result;
}

// 21. Relative Vigor Index (RVI)
function calcRVI(bars, { period = 10 } = {}) {
  const n = bars.length;
  const result = new Array(n).fill(null);
  const nums = bars.map(b => b.c - b.o);
  const dens = bars.map(b => b.h - b.l);
  for (let i = period - 1; i < n; i++) {
    let ns = 0, ds = 0;
    for (let j = i - period + 1; j <= i; j++) { ns += nums[j]; ds += dens[j]; }
    result[i] = ds === 0 ? 0 : ns / ds;
  }
  return result;
}

// 22. Historische Volatilität (annualisiert %)
function calcHistVol(bars, { period = 20 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const logRet = closes.map((c, i) => i > 0 && closes[i-1] > 0 ? Math.log(c / closes[i-1]) : null);
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const sl = logRet.slice(i - period + 1, i + 1).filter(v => v !== null);
    if (sl.length < 2) continue;
    const mean = sl.reduce((a, b) => a + b, 0) / sl.length;
    const variance = sl.reduce((a, b) => a + (b - mean) ** 2, 0) / (sl.length - 1);
    result[i] = Math.sqrt(variance * 252) * 100;
  }
  return result;
}

// 23. Efficiency Ratio (Kaufman)
function calcEfficiencyRatio(bars, { period = 10 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const result = new Array(n).fill(null);
  for (let i = period; i < n; i++) {
    const dir = Math.abs(closes[i] - closes[i - period]);
    let noise = 0;
    for (let j = i - period + 1; j <= i; j++) noise += Math.abs(closes[j] - closes[j-1]);
    result[i] = noise === 0 ? 0 : dir / noise;
  }
  return result;
}

// 24. McGinley Dynamic Regime
function calcMcGinleyRegime(bars, { period = 14 } = {}) {
  const closes = bars.map(b => b.c);
  const n = closes.length;
  const mg = p => {
    const r = [closes[0]];
    for (let i = 1; i < n; i++) {
      const prev = r[i-1];
      const ratio = prev > 0 ? closes[i] / prev : 1;
      r.push(prev + (closes[i] - prev) / Math.max(1, p * Math.pow(ratio, 4)));
    }
    return r;
  };
  const slow = mg(period), fast = mg(Math.max(2, Math.round(period / 3)));
  return closes.map((c, i) => {
    if (c > slow[i] && fast[i] > slow[i]) return "bull";
    if (c < slow[i] && fast[i] < slow[i]) return "bear";
    return "neutral";
  });
}

// 25. Stochastic RSI
function calcStochRSI(bars, { rsiPeriod = 14, stochPeriod = 14, smooth = 3 } = {}) {
  const rsi = calcRSI(bars, { period: rsiPeriod });
  const n = rsi.length;
  const raw = new Array(n).fill(null);
  for (let i = rsiPeriod + stochPeriod - 1; i < n; i++) {
    const sl = rsi.slice(i - stochPeriod + 1, i + 1).filter(v => v !== null);
    if (sl.length < stochPeriod) continue;
    const hi = Math.max(...sl), lo = Math.min(...sl);
    raw[i] = hi === lo ? 50 : ((rsi[i] - lo) / (hi - lo)) * 100;
  }
  return emaSkipLeadingNulls(raw, smooth);
}

// ---------------------------------------------------------------------------
// Registry (46 Indikatoren)
// ---------------------------------------------------------------------------

export const INDICATOR_REGISTRY = {
  // ---- Trend / Regime ----
  regime: {
    id: "regime", label: "Regime (EMA Trend)",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull" }, { value: "neutral", label: "Neutral" }, { value: "bear", label: "Bear" }],
    params: [
      { key: "emaFast", label: "EMA schnell", type: "number", default: 50, min: 2, max: 400 },
      { key: "emaSlow", label: "EMA langsam", type: "number", default: 200, min: 2, max: 400 },
    ],
    compute: calcRegime,
  },
  smaRegime: {
    id: "smaRegime", label: "SMA Kreuz Regime",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull" }, { value: "neutral", label: "Neutral" }, { value: "bear", label: "Bear" }],
    params: [
      { key: "fast", label: "SMA schnell", type: "number", default: 50, min: 2, max: 400 },
      { key: "slow", label: "SMA langsam", type: "number", default: 200, min: 2, max: 400 },
    ],
    compute: calcSMARegime,
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
  parabolicSAR: {
    id: "parabolicSAR", label: "Parabolic SAR",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull (Kurs > SAR)" }, { value: "bear", label: "Bear (Kurs < SAR)" }],
    params: [
      { key: "step", label: "Schrittweite (×100)", type: "number", default: 2, min: 1, max: 10 },
      { key: "max", label: "Maximum (×10)", type: "number", default: 2, min: 1, max: 10 },
    ],
    compute: calcParabolicSAR,
  },
  ichimokuRegime: {
    id: "ichimokuRegime", label: "Ichimoku Regime",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull" }, { value: "neutral", label: "Neutral" }, { value: "bear", label: "Bear" }],
    params: [
      { key: "tenkan", label: "Tenkan-Sen", type: "number", default: 9, min: 2, max: 60 },
      { key: "kijun", label: "Kijun-Sen", type: "number", default: 26, min: 2, max: 120 },
    ],
    compute: calcIchimokuRegime,
  },
  hmaRegime: {
    id: "hmaRegime", label: "Hull MA Regime",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull" }, { value: "neutral", label: "Neutral" }, { value: "bear", label: "Bear" }],
    params: [{ key: "period", label: "Periode", type: "number", default: 20, min: 4, max: 200 }],
    compute: calcHMARegime,
  },
  mcGinleyRegime: {
    id: "mcGinleyRegime", label: "McGinley Dynamic Regime",
    valueType: "category",
    categories: [{ value: "bull", label: "Bull" }, { value: "neutral", label: "Neutral" }, { value: "bear", label: "Bear" }],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 200 }],
    compute: calcMcGinleyRegime,
  },

  // ---- Momentum ----
  rsi: {
    id: "rsi", label: "RSI",
    valueType: "numeric", range: [0, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcRSI,
  },
  stochRSI: {
    id: "stochRSI", label: "Stochastic RSI",
    valueType: "numeric", range: [0, 100],
    params: [
      { key: "rsiPeriod", label: "RSI Periode", type: "number", default: 14, min: 2, max: 100 },
      { key: "stochPeriod", label: "Stoch Periode", type: "number", default: 14, min: 2, max: 100 },
      { key: "smooth", label: "Glättung", type: "number", default: 3, min: 1, max: 20 },
    ],
    compute: calcStochRSI,
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
  ppo: {
    id: "ppo", label: "PPO (Percentage Price Oscillator)",
    valueType: "numeric", range: [-3, 3],
    params: [
      { key: "fast", label: "Schnell", type: "number", default: 12, min: 2, max: 100 },
      { key: "slow", label: "Langsam", type: "number", default: 26, min: 2, max: 200 },
    ],
    compute: calcPPO,
  },
  trix: {
    id: "trix", label: "TRIX",
    valueType: "numeric", range: [-0.5, 0.5],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcTRIX,
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
  kst: {
    id: "kst", label: "KST (Know Sure Thing)",
    valueType: "numeric", range: [-50, 50],
    params: [
      { key: "r1", label: "ROC 1", type: "number", default: 10, min: 2, max: 50 },
      { key: "r2", label: "ROC 2", type: "number", default: 13, min: 2, max: 50 },
      { key: "r3", label: "ROC 3", type: "number", default: 14, min: 2, max: 50 },
      { key: "r4", label: "ROC 4", type: "number", default: 15, min: 2, max: 50 },
    ],
    compute: calcKST,
  },
  coppock: {
    id: "coppock", label: "Coppock Curve",
    valueType: "numeric", range: [-20, 20],
    params: [
      { key: "wmaP", label: "WMA Periode", type: "number", default: 10, min: 2, max: 30 },
      { key: "longROC", label: "Langer ROC", type: "number", default: 14, min: 2, max: 50 },
      { key: "shortROC", label: "Kurzer ROC", type: "number", default: 11, min: 2, max: 50 },
    ],
    compute: calcCoppock,
  },
  rvi: {
    id: "rvi", label: "Relative Vigor Index (RVI)",
    valueType: "numeric", range: [-1, 1],
    params: [{ key: "period", label: "Periode", type: "number", default: 10, min: 2, max: 100 }],
    compute: calcRVI,
  },
  fisher: {
    id: "fisher", label: "Fisher Transform",
    valueType: "numeric", range: [-3, 3],
    params: [{ key: "period", label: "Periode", type: "number", default: 10, min: 2, max: 100 }],
    compute: calcFisher,
  },
  ultimateOsc: {
    id: "ultimateOsc", label: "Ultimate Oscillator",
    valueType: "numeric", range: [0, 100],
    params: [
      { key: "p1", label: "Periode 1", type: "number", default: 7, min: 2, max: 30 },
      { key: "p2", label: "Periode 2", type: "number", default: 14, min: 2, max: 60 },
      { key: "p3", label: "Periode 3", type: "number", default: 28, min: 2, max: 120 },
    ],
    compute: calcUltimateOsc,
  },

  // ---- Oszillatoren ----
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
  aroon: {
    id: "aroon", label: "Aroon Oszillator",
    valueType: "numeric", range: [-100, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 25, min: 2, max: 200 }],
    compute: calcAroon,
  },
  vortex: {
    id: "vortex", label: "Vortex Oszillator (VI+−VI−)",
    valueType: "numeric", range: [-50, 50],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcVortex,
  },

  // ---- Gleitende Durchschnitte / Abstand ----
  emaDist: {
    id: "emaDist", label: "EMA Abstand %",
    valueType: "numeric", range: [-10, 10],
    params: [{ key: "period", label: "EMA Periode", type: "number", default: 50, min: 2, max: 400 }],
    compute: calcEMADist,
  },
  smaDist: {
    id: "smaDist", label: "SMA Abstand %",
    valueType: "numeric", range: [-10, 10],
    params: [{ key: "period", label: "SMA Periode", type: "number", default: 50, min: 2, max: 400 }],
    compute: calcSMADist,
  },
  demaDist: {
    id: "demaDist", label: "DEMA Abstand %",
    valueType: "numeric", range: [-10, 10],
    params: [{ key: "period", label: "Periode", type: "number", default: 21, min: 2, max: 200 }],
    compute: calcDEMADist,
  },
  temaDist: {
    id: "temaDist", label: "TEMA Abstand %",
    valueType: "numeric", range: [-10, 10],
    params: [{ key: "period", label: "Periode", type: "number", default: 21, min: 2, max: 200 }],
    compute: calcTEMADist,
  },
  lrSlope: {
    id: "lrSlope", label: "Linear Regression Slope %",
    valueType: "numeric", range: [-2, 2],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 200 }],
    compute: calcLRSlope,
  },

  // ---- Kanal / Position ----
  bollingerB: {
    id: "bollingerB", label: "Bollinger %B",
    valueType: "numeric", range: [0, 1],
    params: [
      { key: "period", label: "Periode", type: "number", default: 20, min: 2, max: 200 },
      { key: "stdMult", label: "Std-Faktor", type: "number", default: 2, min: 1, max: 5 },
    ],
    compute: calcBollingerB,
  },
  donchianB: {
    id: "donchianB", label: "Donchian Kanal %",
    valueType: "numeric", range: [0, 1],
    params: [{ key: "period", label: "Periode", type: "number", default: 20, min: 2, max: 200 }],
    compute: calcDonchianB,
  },
  keltnerB: {
    id: "keltnerB", label: "Keltner Kanal %",
    valueType: "numeric", range: [0, 1],
    params: [
      { key: "period", label: "EMA Periode", type: "number", default: 20, min: 2, max: 200 },
      { key: "atrMult", label: "ATR Faktor", type: "number", default: 2, min: 1, max: 5 },
      { key: "atrPeriod", label: "ATR Periode", type: "number", default: 14, min: 2, max: 100 },
    ],
    compute: calcKeltnerB,
  },

  // ---- Trendstärke / Volatilität ----
  adx: {
    id: "adx", label: "ADX (Trendstärke)",
    valueType: "numeric", range: [0, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcADX,
  },
  choppiness: {
    id: "choppiness", label: "Choppiness Index",
    valueType: "numeric", range: [38, 100],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcChoppiness,
  },
  massIndex: {
    id: "massIndex", label: "Mass Index",
    valueType: "numeric", range: [20, 30],
    params: [
      { key: "fast", label: "EMA schnell", type: "number", default: 9, min: 2, max: 30 },
      { key: "slow", label: "Summen-Periode", type: "number", default: 25, min: 5, max: 60 },
    ],
    compute: calcMassIndex,
  },
  atrPct: {
    id: "atrPct", label: "ATR %",
    valueType: "numeric", range: [0, 5],
    params: [{ key: "period", label: "Periode", type: "number", default: 14, min: 2, max: 100 }],
    compute: calcATRPct,
  },
  rollingStdDev: {
    id: "rollingStdDev", label: "Std-Abweichung %",
    valueType: "numeric", range: [0, 3],
    params: [{ key: "period", label: "Periode", type: "number", default: 20, min: 2, max: 200 }],
    compute: calcRollingStdDev,
  },
  histVol: {
    id: "histVol", label: "Historische Volatilität % (ann.)",
    valueType: "numeric", range: [0, 50],
    params: [{ key: "period", label: "Periode", type: "number", default: 20, min: 2, max: 100 }],
    compute: calcHistVol,
  },
  efficiencyRatio: {
    id: "efficiencyRatio", label: "Efficiency Ratio (Kaufman)",
    valueType: "numeric", range: [0, 1],
    params: [{ key: "period", label: "Periode", type: "number", default: 10, min: 2, max: 100 }],
    compute: calcEfficiencyRatio,
  },

  // ---- Statistik ----
  zScore: {
    id: "zScore", label: "Z-Score",
    valueType: "numeric", range: [-3, 3],
    params: [{ key: "period", label: "Periode", type: "number", default: 20, min: 2, max: 200 }],
    compute: calcZScore,
  },

  // ---- Elder ----
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
};

// ---------------------------------------------------------------------------
// Condition-Auswertung
// ---------------------------------------------------------------------------

export function evalCondition(value, condition) {
  if (value === null || value === undefined) return false;
  switch (condition.op) {
    case "eq":      return value === condition.value;
    case "gte":     return value >= condition.value;
    case "lte":     return value <= condition.value;
    case "gt":      return value > condition.value;
    case "lt":      return value < condition.value;
    case "between": return value >= condition.value && value <= condition.value2;
    default:        return false;
  }
}

// ---------------------------------------------------------------------------
// Scan-Engine
// ---------------------------------------------------------------------------

export function runScan(bars, indicatorConfigs, forwardSteps = 20) {
  const closes = bars.map(b => b.c);
  const n = bars.length;

  const seriesList = indicatorConfigs.map(cfg => INDICATOR_REGISTRY[cfg.id].compute(bars, cfg.params));

  const matchIdx = [];
  for (let i = 0; i < n; i++) {
    let allOk = true;
    for (let k = 0; k < indicatorConfigs.length; k++) {
      if (!evalCondition(seriesList[k][i], indicatorConfigs[k].condition)) { allOk = false; break; }
    }
    if (allOk) matchIdx.push(i);
  }

  const complete = matchIdx.filter(i => i + forwardSteps < n);
  const open     = matchIdx.filter(i => i + forwardSteps >= n);

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
  const avgPath = sums.map(s => count > 0 ? s / count : null);
  const stdPath = sumsSq.map((sq, s) =>
    count > 0 ? Math.sqrt(Math.max(sq / count - avgPath[s] * avgPath[s], 0)) : null
  );

  let winRate = null, median = null, maxGain = null, maxLoss = null, profitFactor = null, expectedValue = null;

  if (count > 0) {
    const wins   = finalReturns.filter(r => r > 0);
    const losses = finalReturns.filter(r => r < 0);
    const gp = wins.reduce((a, b) => a + b, 0);
    const gl = Math.abs(losses.reduce((a, b) => a + b, 0));
    winRate = (wins.length / count) * 100;

    const sorted = [...finalReturns].sort((a, b) => a - b);
    median  = count % 2 === 0 ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2 : sorted[Math.floor(count / 2)];
    maxGain = sorted[count - 1];
    maxLoss = sorted[0];

    profitFactor  = gl === 0 ? null : gp / gl;
    const aw = wins.length > 0 ? gp / wins.length : 0;
    const al = losses.length > 0 ? gl / losses.length : 0;
    expectedValue = (winRate / 100) * aw - ((100 - winRate) / 100) * al;
  }

  return {
    totalBars: n, sampleSize: count,
    avgPath, stdPath, winRate,
    paths,
    matchDates:  complete.map(i => bars[i].t),
    openSignals: open.map(i => bars[i].t),
    median, maxGain, maxLoss, profitFactor, expectedValue,
  };
}
