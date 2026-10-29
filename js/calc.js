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
//   avg R        = mean R multiple of trades that have a stop (others have no R)
//   streaks      = longest run of consecutive wins / losses in time order;
//                  a breakeven trade ends both runs
//   green days   = days with net > 0 ÷ days traded

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

// ------------------------------------------------------------ trading days
//
// A trade belongs to a "trading day". Two rules:
//   'cme'      — the CME Globex session: the day ends at 5:00 PM New York time,
//                so a trade at 6:30 PM ET Tuesday counts for Wednesday (and
//                Sunday-evening trades count for Monday). Daylight saving is
//                handled by the time zone database. This is how Tradeify and
//                other futures prop firms define a day.
//   'midnight' — midnight on this device.
let tradingDay = 'cme';

export function setTradingDay(mode) { tradingDay = mode === 'midnight' ? 'midnight' : 'cme'; }
export function getTradingDay() { return tradingDay; }

/** Plain calendar date "YYYY-MM-DD" of a local Date (no session rule). */
export function dateKey(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** Local Date at noon for a "YYYY-MM-DD" key (noon avoids DST edge cases). */
export function keyDate(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d, 12);
}

let nyFormat = null;
/** {y, m, d, h} of an instant in New York. */
export function nyParts(d) {
  nyFormat = nyFormat || new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23',
  });
  const p = Object.fromEntries(nyFormat.formatToParts(d).map((x) => [x.type, x.value]));
  return { y: Number(p.year), m: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24 };
}

/** Trading day "YYYY-MM-DD" of an ISO timestamp (or Date), under the current rule. */
export function dayKey(dateTime) {
  const d = dateTime instanceof Date ? dateTime : new Date(dateTime);
  if (tradingDay === 'midnight') return dateKey(d);
  const p = nyParts(d);
  // From 5 PM New York the session belongs to the next calendar day.
  const day = new Date(Date.UTC(p.y, p.m - 1, p.d + (p.h >= 17 ? 1 : 0)));
  return `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, '0')}-${String(day.getUTCDate()).padStart(2, '0')}`;
}

/** Weekday (0 = Sun) of a trade's trading day. */
export const tradingWeekday = (dateTime) => keyDate(dayKey(dateTime)).getDay();

/** Hour of entry: New York hour under the CME rule, device hour otherwise. */
export const entryHour = (dateTime) => (tradingDay === 'cme' ? nyParts(new Date(dateTime)).h : new Date(dateTime).getHours());

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
  const d = keyDate(dayKey(now));
  d.setHours(0, 0, 0, 0);
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

/**
 * A stats window: {start, end} (end exclusive) in local time, `offset` periods
 * back from the current one (0 = current, -1 = previous …). 'all' → nulls.
 * '3m' is the current month plus the two before it, stepping 3 months at a time.
 */
export function periodRange(period, offset = 0, now = new Date()) {
  // Periods are made of trading days, counted from today's trading day.
  const d = keyDate(dayKey(now));
  d.setHours(0, 0, 0, 0);
  switch (period) {
    case 'week': {
      const start = new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7) + offset * 7);
      return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) };
    }
    case 'month':
      return { start: new Date(d.getFullYear(), d.getMonth() + offset, 1), end: new Date(d.getFullYear(), d.getMonth() + offset + 1, 1) };
    case '3m':
      return { start: new Date(d.getFullYear(), d.getMonth() - 2 + offset * 3, 1), end: new Date(d.getFullYear(), d.getMonth() + 1 + offset * 3, 1) };
    default:
      return { start: null, end: null };
  }
}

/** Trades whose trading day falls in [start, end). Dates are compared as day keys. */
export function inRange(list, { start, end }) {
  const a = start ? dateKey(start) : null;
  const b = end ? dateKey(end) : null;
  return list.filter((t) => {
    const k = dayKey(t.dateTime);
    return (!a || k >= a) && (!b || k < b);
  });
}

/** Sum of gross P&L and of fees: {gross, fees}. net = gross − fees. */
export function grossAndFees(list) {
  let gross = 0, fees = 0;
  for (const t of list) { gross += t.m.gross; fees += t.m.fees; }
  return { gross: round2(gross), fees: round2(fees) };
}

/** Mean R over trades that have a stop: {avg, count} (avg null when none). */
export function averageR(list) {
  const rs = list.map((t) => t.m.r).filter((r) => r !== null && Number.isFinite(r));
  return { avg: rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : null, count: rs.length };
}

/** Longest consecutive wins and losses in time order: {wins, losses}. */
export function streaks(list) {
  let w = 0, l = 0, maxW = 0, maxL = 0;
  for (const t of [...list].sort(byTime)) {
    if (t.m.net > 0) { w++; l = 0; } else if (t.m.net < 0) { l++; w = 0; } else { w = 0; l = 0; }
    maxW = Math.max(maxW, w);
    maxL = Math.max(maxL, l);
  }
  return { wins: maxW, losses: maxL };
}

/** Days with net > 0: {green, days}. */
export function greenDays(list) {
  const days = dailyPnl(list);
  return { green: days.filter((d) => d.net > 0).length, days: days.length };
}

/** Largest single winning and losing trade (null when none). */
export function largestTrades(list) {
  let win = null, loss = null;
  for (const t of list) {
    if (t.m.net > 0 && (!win || t.m.net > win.m.net)) win = t;
    if (t.m.net < 0 && (!loss || t.m.net < loss.m.net)) loss = t;
  }
  return { win, loss };
}

export function inPeriod(list, period, now = new Date()) {
  const start = periodStart(period, now);
  if (!start) return list;
  return inRange(list, { start, end: null });
}

// ------------------------------------------------------------ price entry

/** Nearest whole tick. */
export function snapToTick(price, tick) {
  if (!hasNum(price) || !(tick > 0)) return price;
  return clean(Math.round(Number(price) / tick) * tick);
}

/**
 * Shorthand price entry: typing only the last digits of a price fills the
 * rest from a reference price. With reference 25812.25, "836.5" → 25836.5
 * and "05" → 25805. When the shorthand could fall either side of a round
 * number (reference 25998, typed "003"), the value nearest the reference wins.
 * Returns the number unchanged when it is already as long as the reference.
 */
export function expandPrice(typed, reference) {
  const s = String(typed ?? '').trim().replace(',', '.');
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s) || !hasNum(reference) || Number(reference) <= 0) {
    return hasNum(s) ? Number(s) : null;
  }
  const intDigits = (s.split('.')[0] || '').length;
  const refDigits = String(Math.floor(Number(reference))).length;
  const v = Number(s);
  if (intDigits === 0 || intDigits >= refDigits) return v;
  const step = 10 ** intDigits;
  const base = Math.floor(Number(reference) / step) * step;
  const candidates = [base - step, base, base + step].map((b) => clean(b + v)).filter((x) => x > 0);
  return candidates.reduce((best, x) => (Math.abs(x - reference) < Math.abs(best - reference) ? x : best));
}

/** Stop or target price from a distance in points. kind: 'stop' | 'target'. */
export function priceFromPoints(entry, distance, side, kind) {
  if (!hasNum(entry) || !hasNum(distance)) return null;
  const below = (side === 'short') === (kind === 'target');
  return clean(Number(entry) + (below ? -1 : 1) * Math.abs(Number(distance)));
}

/** Distance in points from entry to a stop or target price. */
export function pointsFromPrice(entry, price) {
  if (!hasNum(entry) || !hasNum(price)) return null;
  return clean(Math.abs(Number(price) - Number(entry)));
}

// --------------------------------------------------------- time breakdowns

function groupRows(list, keyOf, order) {
  const map = new Map();
  for (const t of list) {
    const k = keyOf(t);
    const e = map.get(k) || { key: k, net: 0, count: 0, wins: 0, losses: 0 };
    e.net = round2(e.net + t.m.net);
    e.count++;
    if (t.m.net > 0) e.wins++;
    else if (t.m.net < 0) e.losses++;
    map.set(k, e);
  }
  return order.filter((k) => map.has(k)).map((k) => {
    const e = map.get(k);
    return { ...e, winRate: e.wins + e.losses ? e.wins / (e.wins + e.losses) : null };
  });
}

/**
 * Net by hour of entry: [{key: hour 0–23, net, count, wins, losses, winRate}].
 * New York hours under the CME rule (so 09:00 is the open), device hours otherwise.
 */
export function pnlByHour(list) {
  return groupRows(list, (t) => entryHour(t.dateTime), [...Array(24).keys()]);
}

/** Net by weekday of the trading day, Monday first: key 1 = Mon … 0 = Sun. */
export function pnlByWeekday(list) {
  return groupRows(list, (t) => tradingWeekday(t.dateTime), [1, 2, 3, 4, 5, 6, 0]);
}

/** Net as a % of account size (e.g. 0.19 for +$95 on $50,000). null without a size. */
export function pctOfAccount(net, accountSize) {
  return accountSize > 0 ? Math.round((net / accountSize) * 10000) / 100 : null;
}
