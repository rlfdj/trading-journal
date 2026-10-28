// Unit tests for calc.js. Run by opening tests.html.
import * as calc from '../calc.js';
import * as csv from '../csv.js';

const MNQ = { symbol: 'MNQ', pointValue: 2, tickSize: 0.25 };
const ES = { symbol: 'ES', pointValue: 50, tickSize: 0.25 };
const settings = { instruments: [MNQ, ES] };

let seq = 0;
function trade(o) {
  seq++;
  return {
    id: `t${seq}`,
    instrument: 'MNQ',
    side: 'long',
    contracts: 1,
    fees: 0,
    mistakes: [],
    setup: 'ORB',
    dateTime: new Date(2026, 9, 1, 9, 30 + seq).toISOString(),
    ...o,
  };
}
// Trade with a given net P&L (MNQ, 1 contract, $2/pt → points = net / 2).
function net(n, o = {}) {
  return trade({ entry: 100, exit: 100 + n / 2, ...o });
}
const at = (day, hh = 10, mm = 0) => new Date(2026, 9, day, hh, mm).toISOString();

function eq(actual, expected, msg = '') {
  if (!Object.is(actual, expected) && !(actual === expected)) {
    throw new Error(`${msg} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}
function near(actual, expected, msg = '', eps = 1e-9) {
  if (Math.abs(actual - expected) > eps) throw new Error(`${msg} expected ≈${expected}, got ${actual}`);
}

export const tests = [
  ['points: long is exit − entry', () => {
    eq(calc.points({ side: 'long', entry: 25812.25, exit: 25836.5 }), 24.25);
  }],
  ['points: short is entry − exit', () => {
    eq(calc.points({ side: 'short', entry: 25812.25, exit: 25821 }), -8.75);
  }],
  ['points: no float noise', () => {
    eq(calc.points({ side: 'long', entry: 0.1, exit: 0.3 }), 0.2);
  }],
  ['mockup trade: +$97.00, +24.25 pts, 2.94R, $33 risk', () => {
    const m = calc.tradeMetrics(
      { side: 'long', contracts: 2, entry: 25812.25, exit: 25836.5, stop: 25804, fees: 0 }, MNQ);
    eq(m.points, 24.25, 'points');
    eq(m.gross, 97, 'gross');
    eq(m.net, 97, 'net');
    near(m.r, 24.25 / 8.25, 'R');
    eq(m.risk, 33, 'risk');
    eq(m.result, 'win');
  }],
  ['net = gross − fees', () => {
    const m = calc.tradeMetrics({ side: 'long', contracts: 3, entry: 5000, exit: 5001, fees: 4.5 }, ES);
    eq(m.gross, 150);
    eq(m.net, 145.5);
  }],
  ['short loss with fees', () => {
    const m = calc.tradeMetrics({ side: 'short', contracts: 1, entry: 100, exit: 108.75, fees: 0.74 }, MNQ);
    eq(m.gross, -17.5);
    eq(m.net, -18.24);
    eq(m.result, 'loss');
  }],
  ['R and risk are null without a stop', () => {
    const m = calc.tradeMetrics({ side: 'long', contracts: 1, entry: 100, exit: 101, fees: 0 }, MNQ);
    eq(m.r, null);
    eq(m.risk, null);
  }],
  ['R is null when stop equals entry', () => {
    const m = calc.tradeMetrics({ side: 'long', contracts: 1, entry: 100, exit: 101, stop: 100, fees: 0 }, MNQ);
    eq(m.r, null);
  }],
  ['negative R on a losing trade', () => {
    const m = calc.tradeMetrics({ side: 'short', contracts: 1, entry: 100, exit: 105, stop: 110, fees: 0 }, MNQ);
    eq(m.r, -0.5);
    eq(m.risk, 20);
  }],
  ['breakeven when net is exactly 0', () => {
    const m = calc.tradeMetrics({ side: 'long', contracts: 1, entry: 100, exit: 100.5, fees: 1 }, MNQ);
    eq(m.net, 0);
    eq(m.result, 'be');
  }],
  ['defaultFees = commission × contracts', () => {
    eq(calc.defaultFees(0.74, 3), 2.22);
    eq(calc.defaultFees('', 3), 0);
  }],
  ['Tradeify MNQ: 2 contracts at $1.82 RT → $3.64 fees', () => {
    eq(calc.feesFor({ commission: 1.82 }, 'MNQ', 2), 3.64);
    const m = calc.tradeMetrics(
      { side: 'long', contracts: 2, entry: 25812.25, exit: 25836.5, fees: 3.64 }, MNQ);
    eq(m.gross, 97);
    eq(m.net, 93.36);
  }],
  ['isOnTick', () => {
    eq(calc.isOnTick(25812.25, 0.25), true);
    eq(calc.isOnTick(25812.3, 0.25), false);
    eq(calc.isOnTick(1.3, 0.1), true);
    eq(calc.isOnTick('', 0.25), false);
  }],
  ['summarize: win rate excludes breakeven', () => {
    const s = calc.summarize(calc.enrich([net(100), net(-50), net(0), net(30)], settings));
    eq(s.count, 4);
    eq(s.wins, 2);
    eq(s.losses, 1);
    eq(s.breakeven, 1);
    near(s.winRate, 2 / 3);
  }],
  ['summarize: profit factor, expectancy, averages', () => {
    const s = calc.summarize(calc.enrich([net(100), net(-50), net(0), net(30)], settings));
    eq(s.grossWins, 130);
    eq(s.grossLosses, 50);
    near(s.profitFactor, 2.6);
    eq(s.net, 80);
    eq(s.expectancy, 20);
    eq(s.avgWin, 65);
    eq(s.avgLoss, -50);
  }],
  ['summarize: no losses → profit factor ∞', () => {
    const s = calc.summarize(calc.enrich([net(10)], settings));
    eq(s.profitFactor, Infinity);
    eq(s.avgLoss, null);
  }],
  ['summarize: empty list', () => {
    const s = calc.summarize([]);
    eq(s.count, 0);
    eq(s.winRate, null);
    eq(s.profitFactor, null);
    eq(s.expectancy, null);
  }],
  ['maxDrawdown: peak to trough', () => {
    const list = calc.enrich([
      net(100, { dateTime: at(1) }),
      net(50, { dateTime: at(2) }),   // peak 150
      net(-80, { dateTime: at(3) }),
      net(-40, { dateTime: at(4) }),  // trough 30 → dd −120
      net(200, { dateTime: at(5) }),
      net(-60, { dateTime: at(6) }),
    ], settings);
    const dd = calc.maxDrawdown(list);
    eq(dd.amount, -120);
    eq(dd.peakAt, at(2));
    eq(dd.troughAt, at(4));
  }],
  ['maxDrawdown: losing from the start counts from 0', () => {
    const dd = calc.maxDrawdown(calc.enrich([net(-30, { dateTime: at(1) }), net(-20, { dateTime: at(2) })], settings));
    eq(dd.amount, -50);
    eq(dd.peakAt, null);
  }],
  ['maxDrawdown: sorts by time first', () => {
    const dd = calc.maxDrawdown(calc.enrich([net(-90, { dateTime: at(3) }), net(100, { dateTime: at(1) })], settings));
    eq(dd.amount, -90);
  }],
  ['maxDrawdown: none when only rising', () => {
    eq(calc.maxDrawdown(calc.enrich([net(10), net(20)], settings)).amount, 0);
  }],
  ['dailyPnl and best/worst day', () => {
    const list = calc.enrich([
      net(100, { dateTime: at(1, 9) }), net(-20, { dateTime: at(1, 11) }),
      net(-70, { dateTime: at(2) }),
      net(30, { dateTime: at(5) }),
    ], settings);
    const days = calc.dailyPnl(list);
    eq(days.length, 3);
    eq(days[0].day, '2026-10-01');
    eq(days[0].net, 80);
    eq(days[0].count, 2);
    const bw = calc.bestWorstDay(list);
    eq(bw.best.day, '2026-10-01');
    eq(bw.worst.net, -70);
  }],
  ['equityCurve is cumulative by day', () => {
    const curve = calc.equityCurve(calc.enrich([
      net(100, { dateTime: at(1) }), net(-70, { dateTime: at(2) }), net(30, { dateTime: at(5) }),
    ], settings));
    eq(curve.map((p) => p.equity).join(','), '100,30,60');
  }],
  ['pnlBySetup', () => {
    const rows = calc.pnlBySetup(calc.enrich([
      net(100, { setup: 'ORB' }), net(-40, { setup: 'ORB' }), net(-10, { setup: 'Pullback' }), net(5, { setup: '' }),
    ], settings));
    eq(rows[0].setup, 'ORB');
    eq(rows[0].net, 60);
    eq(rows[0].count, 2);
    eq(rows[rows.length - 1].setup, 'Pullback');
    eq(rows.some((r) => r.setup === 'No setup'), true);
  }],
  ['pnlByField groups by a detail, skips blanks, keeps option order', () => {
    const rows = calc.pnlByField(calc.enrich([
      net(60, { depth: 'Shallow' }), net(-20, { depth: 'Shallow' }), net(0, { depth: 'Shallow' }),
      net(-40, { depth: 'Deep' }),
      net(500, {}),                       // no depth: left out
    ], settings), 'depth', ['Shallow', 'Deep']);
    eq(rows.length, 2);
    eq(rows[0].value, 'Shallow');
    eq(rows[0].net, 40);
    eq(rows[0].count, 3);
    near(rows[0].winRate, 0.5);
    eq(rows[1].net, -40);
    eq(rows[1].winRate, 0);
  }],
  ['costOfMistakes uses losing trades only', () => {
    const rows = calc.costOfMistakes(calc.enrich([
      net(-50, { mistakes: ['Chased', 'Oversized'] }),
      net(-30, { mistakes: ['Chased'] }),
      net(80, { mistakes: ['Chased'] }),   // a winner: ignored
      net(-10, { mistakes: [] }),
    ], settings));
    eq(rows.length, 2);
    eq(rows[0].mistake, 'Chased');
    eq(rows[0].cost, -80);
    eq(rows[0].count, 2);
    eq(rows[1].cost, -50);
  }],
  ['periodStart: week starts Monday', () => {
    const wed = new Date(2026, 9, 28, 15); // Wed Oct 28 2026
    eq(calc.dayKey(calc.periodStart('week', wed)), '2026-10-26');
    const sun = new Date(2026, 10, 1, 15); // Sun Nov 1 2026
    eq(calc.dayKey(calc.periodStart('week', sun)), '2026-10-26');
  }],
  ['periodStart: month, 3M, all', () => {
    const now = new Date(2026, 0, 15);
    eq(calc.dayKey(calc.periodStart('month', now)), '2026-01-01');
    eq(calc.dayKey(calc.periodStart('3m', now)), '2025-11-01');
    eq(calc.periodStart('all', now), null);
  }],
  ['inPeriod filters by start', () => {
    const list = [net(1, { dateTime: at(1) }), net(1, { dateTime: new Date(2026, 8, 30).toISOString() })];
    eq(calc.inPeriod(list, 'month', new Date(2026, 9, 20)).length, 1);
    eq(calc.inPeriod(list, 'all').length, 2);
  }],
  ['CSV import: date formats people type in a spreadsheet', () => {
    const want = calc.dayKey(new Date(2026, 9, 21)) + ' 09:42';
    const show = (d) => (d ? `${calc.dayKey(d)} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}` : null);
    eq(show(csv.parseDateTime('2026-10-21 09:42')), want);
    eq(show(csv.parseDateTime('2026-10-21T09:42:00')), want);
    eq(show(csv.parseDateTime('10/21/2026 9:42 AM')), want);
    eq(show(csv.parseDateTime('10/21/2026 9:42')), want);
    eq(show(csv.parseDateTime('21/10/2026 09:42')), want);
    eq(show(csv.parseDateTime('10/21/26 9:42:00 AM')), want);
    eq(show(csv.parseDateTime('10/21/2026 1:05 PM')), '2026-10-21 13:05');
    eq(show(csv.parseDateTime('10/21/2026 12:15 AM')), '2026-10-21 00:15');
    eq(csv.parseDateTime('2026-02-30 09:00'), null);
    eq(csv.parseDateTime('next tuesday'), null);
    eq(csv.parseDateTime(''), null);
  }],
  ['CSV import: comma and semicolon files', () => {
    eq(JSON.stringify(csv.parseCsv('a,b\n1,"x, y"\n')), JSON.stringify([['a', 'b'], ['1', 'x, y']]));
    eq(JSON.stringify(csv.parseCsv('a;b\r\n1;2,5\r\n')), JSON.stringify([['a', 'b'], ['1', '2,5']]));
  }],
  ['round2 never returns -0', () => {
    eq(Object.is(calc.round2(-0.001), -0), false);
    eq(calc.round2(1.005 + 0.0000001), 1.01);
  }],
];

export function run() {
  return tests.map(([name, fn]) => {
    try { fn(); return { name, ok: true }; }
    catch (e) { return { name, ok: false, error: e.message }; }
  });
}
