// calc.js — every number the app shows is computed here.
// Pure functions only: no DOM, no storage. Covered by tests.html.
//
// Definitions
//   points       = exit − entry (long) or entry − exit (short)
//   gross P&L    = points × point value × contracts
//   net P&L      = gross − fees
//   R multiple   = points ÷ |entry − stop|          (only when a stop is set)
//   risk $       = |entry − stop| × point value × contracts
//   win / loss   = net > 0 / net < 0; net = 0 is breakeven (excluded from win rate)
//   win rate     = wins ÷ (wins + losses)
//   profit factor= sum of winning trades' net ÷ |sum of losing trades' net|
//   expectancy   = total net ÷ number of trades
//   avg win/loss = winning net ÷ wins, losing net ÷ losses
//   max drawdown = deepest peak-to-trough fall of the cumulative net equity
//                  curve (trade by trade, starting from 0)
//   cost of a mistake = sum of net P&L of losing trades tagged with it

/** Round to cents, never returning -0. */
export function round2(x) {
  const r = Math.round(x * 100) / 100;
  return r === 0 ? 0 : r;
}

/** Round away float noise (e.g. 0.1 + 0.2) while keeping tick precision. */
function clean(x) {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

export function hasNum(v) {
  return v !== null && v !== undefined && v !== '' && Number.isFinite(Number(v));
}

export function points(trade) {
  const entry = Number(trade.entry);
  const exit = Number(trade.exit);
  return clean(trade.side === 'short' ? entry - exit : exit - entry);
}

export function findInstrument(settings, symbol) {
  return settings.instruments.find((i) => i.symbol === symbol) || null;
}

/** Round-trip fees for a trade: commission per contract × contracts. */
export function defaultFees(commissionPerContract, contracts) {
  return round2((Number(commissionPerContract) || 0) * (Number(contracts) || 0));
}

/** Default fees for a trade from settings (one commission rate for every instrument). */
export function feesFor(settings, symbol, contracts) {
  return defaultFees(settings.commission, contracts);
}

/** True when price is a whole number of ticks. */
export function isOnTick(price, tick) {
  if (!hasNum(price) || !(tick > 0)) return false;
  const n = Number(price) / tick;
  return Math.abs(n - Math.round(n)) < 1e-6;
}

export function resultOf(net) {
  return net > 0 ? 'win' : net < 0 ? 'loss' : 'be';
}

/** All per-trade numbers. instrument supplies pointValue. */
export function tradeMetrics(trade, instrument) {
  const pv = instrument ? Number(instrument.pointValue) : 0;
  const contracts = Number(trade.contracts) || 0;
  const pts = points(trade);
  const gross = round2(pts * pv * contracts);
  const fees = round2(Number(trade.fees) || 0);
  const net = round2(gross - fees);
  let r = null;
  let risk = null;
  if (hasNum(trade.stop)) {
    const dist = clean(Math.abs(Number(trade.entry) - Number(trade.stop)));
    if (dist > 0) {
      r = pts / dist;
      risk = round2(dist * pv * contracts);
    }
  }
  return { points: pts, gross, fees, net, r, risk, result: resultOf(net) };
}

/** Attach metrics (as .m) to each trade, using the settings' instruments. */
export function enrich(trades, settings) {
  return trades.map((t) => ({ ...t, m: tradeMetrics(t, findInstrument(settings, t.instrument)) }));
}

export function summarize(list) {
  let wins = 0, losses = 0, breakeven = 0, grossWins = 0, grossLosses = 0, net = 0;
  for (const t of list) {
    const n = t.m.net;
    net += n;
    if (n > 0) { wins++; grossWins += n; }
    else if (n < 0) { losses++; grossLosses += -n; }
    else breakeven++;
  }
  net = round2(net);
  grossWins = round2(grossWins);
  grossLosses = round2(grossLosses);
  const count = list.length;
  const decided = wins + losses;
  let profitFactor = null;
  if (grossLosses > 0) profitFactor = grossWins / grossLosses;
  else if (grossWins > 0) profitFactor = Infinity;
  return {
    count, wins, losses, breakeven, net, grossWins, grossLosses, profitFactor,
    winRate: decided ? wins / decided : null,
    expectancy: count ? round2(net / count) : null,
    avgWin: wins ? round2(grossWins / wins) : null,
    avgLoss: losses ? round2(-grossLosses / losses) : null,
  };
}

/** Local calendar day "YYYY-MM-DD" of an ISO timestamp (or Date). */
export function dayKey(dateTime) {
  const d = dateTime instanceof Date ? dateTime : new Date(dateTime);
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

const byTime = (a, b) => (a.dateTime < b.dateTime ? -1 : a.dateTime > b.dateTime ? 1 : 0);

/** [{day, net, count}] in date order. */
export function dailyPnl(list) {
  const map = new Map();
  for (const t of [...list].sort(byTime)) {
    const k = dayKey(t.dateTime);
    const e = map.get(k) || { day: k, net: 0, count: 0 };
    e.net = round2(e.net + t.m.net);
    e.count++;
    map.set(k, e);
  }
  return [...map.values()];
}

export function bestWorstDay(list) {
  const days = dailyPnl(list);
  if (!days.length) return { best: null, worst: null };
  let best = days[0], worst = days[0];
  for (const d of days) {
    if (d.net > best.net) best = d;
    if (d.net < worst.net) worst = d;
  }
  return { best, worst };
}

/** Daily cumulative net, starting from 0: [{day, equity}]. */
export function equityCurve(list) {
  let eq = 0;
  return dailyPnl(list).map((d) => {
    eq = round2(eq + d.net);
    return { day: d.day, equity: eq };
  });
}

/**
 * Max drawdown on the trade-by-trade cumulative net curve, starting at 0.
 * amount is ≤ 0. peakAt is null when the peak is the starting point.
 */
export function maxDrawdown(list) {
  let eq = 0, peak = 0, peakAt = null;
  let amount = 0, from = null, to = null;
  for (const t of [...list].sort(byTime)) {
    eq = round2(eq + t.m.net);
    if (eq > peak) { peak = eq; peakAt = t.dateTime; }
    const dd = round2(eq - peak);
    if (dd < amount) { amount = dd; from = peakAt; to = t.dateTime; }
  }
  return { amount, peakAt: from, troughAt: to };
}

/** [{setup, net, count}] sorted best first. */
export function pnlBySetup(list) {
  const map = new Map();
  for (const t of list) {
    const k = t.setup || 'No setup';
    const e = map.get(k) || { setup: k, net: 0, count: 0 };
    e.net = round2(e.net + t.m.net);
    e.count++;
    map.set(k, e);
  }
  return [...map.values()].sort((a, b) => b.net - a.net);
}

/**
 * Group trades by the value of one field (e.g. a setup detail like 'depth').
 * Trades with no value are left out. Returns [{value, net, count, wins, losses, winRate}]
 * in the order of `options` when given, otherwise best first.
 */
export function pnlByField(list, key, options) {
  const map = new Map();
  for (const t of list) {
    const v = t[key];
    if (!v) continue;
    const e = map.get(v) || { value: v, net: 0, count: 0, wins: 0, losses: 0 };
    e.net = round2(e.net + t.m.net);
    e.count++;
    if (t.m.net > 0) e.wins++;
    else if (t.m.net < 0) e.losses++;
    map.set(v, e);
  }
  const rows = [...map.values()].map((e) => ({ ...e, winRate: e.wins + e.losses ? e.wins / (e.wins + e.losses) : null }));
  if (options) return options.map((o) => rows.find((r) => r.value === o)).filter(Boolean);
  return rows.sort((a, b) => b.net - a.net);
}

/** [{mistake, cost, count}] from losing trades only; most expensive first. */
export function costOfMistakes(list) {
  const map = new Map();
  for (const t of list) {
    if (!(t.m.net < 0)) continue;
    for (const k of t.mistakes || []) {
      const e = map.get(k) || { mistake: k, cost: 0, count: 0 };
      e.cost = round2(e.cost + t.m.net);
      e.count++;
      map.set(k, e);
    }
  }
  return [...map.values()].sort((a, b) => a.cost - b.cost);
}

/** Start of a stats period in local time. Weeks start Monday. null = all time. */
export function periodStart(period, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  switch (period) {
    case 'week': {
      const offset = (d.getDay() + 6) % 7; // Mon = 0
      d.setDate(d.getDate() - offset);
      return d;
    }
    case 'month':
      return new Date(d.getFullYear(), d.getMonth(), 1);
    case '3m':
      return new Date(d.getFullYear(), d.getMonth() - 2, 1);
    default:
      return null;
  }
}

export function inPeriod(list, period, now = new Date()) {
  const start = periodStart(period, now);
  if (!start) return list;
  return list.filter((t) => new Date(t.dateTime) >= start);
}
