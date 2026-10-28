// Stats: period switcher, equity curve, stat tiles, P&L by setup, by time of
// day and weekday, cost of mistakes. Swipe sideways to change period; drag
// along the curve to read the balance on any day.

import * as store from '../store.js';
import {
  enrich, inPeriod, summarize, equityCurve, maxDrawdown, bestWorstDay, pnlBySetup, costOfMistakes, dailyPnl, pnlByField,
  pnlByHour, pnlByWeekday, accountRules,
} from '../calc.js';
import { pageSwipe, slideIn } from '../gestures.js';
import { rulesHtml } from './rules.js';
import { detailsFor } from '../defaults.js';
import { money, pct, ratio, tone, shortDate, monthShort, fromDayKey, esc } from '../format.js';

const PERIODS = [['week', 'Week'], ['month', 'Month'], ['3m', '3M'], ['all', 'All']];
let period = 'month';
let slideDir = 0;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;

const winOf = (r) => (r.winRate === null ? '' : ` · ${pct(r.winRate)} win`);
const dollars = (x) => `$${Math.round(Math.abs(x)).toLocaleString('en-US')}`;

function rangeLabel(days) {
  if (!days.length) return '';
  const a = fromDayKey(days[0].day);
  const b = fromDayKey(days[days.length - 1].day);
  if (days.length === 1) return shortDate(days[0].day);
  if (a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth()) {
    return `${monthShort(a.getMonth())} ${a.getDate()}–${b.getDate()}`;
  }
  const yr = a.getFullYear() !== b.getFullYear();
  return `${shortDate(days[0].day)}${yr ? ` ’${String(a.getFullYear()).slice(2)}` : ''} – ${shortDate(days[days.length - 1].day)}${yr ? ` ’${String(b.getFullYear()).slice(2)}` : ''}`;
}

let geometry = null; // last drawn curve, for scrubbing

/** Equity curve as inline SVG sized to the card. */
function curveSvg(curve, width) {
  const H = 150, padY = 8, padX = 4;
  const pts = [{ day: null, equity: 0 }, ...curve];
  const vals = pts.map((p) => p.equity);
  const min = Math.min(0, ...vals);
  const max = Math.max(0, ...vals);
  const span = max - min || 1;
  const x = (i) => padX + (i * (width - padX * 2)) / Math.max(1, pts.length - 1);
  const y = (v) => padY + (H - padY * 2) * (1 - (v - min) / span);
  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.equity).toFixed(1)}`).join(' ');
  const zero = y(0).toFixed(1);
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${zero} L${x(0).toFixed(1)},${zero} Z`;
  const last = pts[pts.length - 1];
  geometry = { pts, x, y, width };
  const color = last.equity >= 0 ? 'var(--pos)' : 'var(--neg)';
  const tint = last.equity >= 0 ? 'var(--pos-tint)' : 'var(--neg-tint)';
  return `
    <svg class="equity-svg" viewBox="0 0 ${width} ${H}" width="${width}" height="${H}" role="img"
      aria-label="Equity curve from $0 to ${money(last.equity)}">
      <path d="${area}" fill="${tint}" />
      <line x1="${padX}" x2="${width - padX}" y1="${zero}" y2="${zero}" stroke="var(--muted)" stroke-width="1" stroke-dasharray="3 4" opacity="0.6"/>
      <path d="${line}" fill="none" stroke="${color}" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/>
      <circle cx="${x(pts.length - 1).toFixed(1)}" cy="${y(last.equity).toFixed(1)}" r="3.6" fill="${color}"/>
      <g data-cursor style="display:none">
        <line y1="0" y2="${H}" stroke="var(--ink)" stroke-width="1" opacity="0.35"/>
        <circle r="5" fill="var(--card)" stroke="var(--ink)" stroke-width="2"/>
      </g>
    </svg>`;
}

function barsHtml(rows, labelOf, valueOf, countOf, extraOf = () => '') {
  const maxAbs = Math.max(...rows.map((r) => Math.abs(valueOf(r))), 1);
  return rows.map((r) => {
    const v = valueOf(r);
    return `
      <div class="bar-row">
        <div class="bar-label"><span>${esc(labelOf(r))} <span class="muted">· ${countOf(r)} trade${countOf(r) === 1 ? '' : 's'}${extraOf(r)}</span></span>
          <span class="num ${tone(v)}">${money(v)}</span></div>
        <div class="bar-track"><div class="bar-fill ${tone(v)}" style="width:${Math.max(2, (Math.abs(v) / maxAbs) * 100).toFixed(1)}%"></div></div>
      </div>`;
  }).join('');
}

export async function render(el, { settings, refresh }) {
  const all = enrich(await store.listTrades(), settings);
  const list = inPeriod(all, period);
  const s = summarize(list);
  const rules = accountRules(all, { maxDrawdown: settings.drawdownLimit, since: settings.accountStart });
  const hours = pnlByHour(list);
  const weekdays = pnlByWeekday(list);
  const days = dailyPnl(list);
  const curve = equityCurve(list);
  const dd = maxDrawdown(list);
  const bw = bestWorstDay(list);
  const setups = pnlBySetup(list);
  const mistakes = costOfMistakes(list);
  const mistakeTotal = mistakes.reduce((a, m) => a + m.cost, 0);
  // One breakdown card per setup that has details (Trend Pullback).
  const breakdowns = Object.keys(settings.setupDetails || {}).map((setup) => {
    const trades = list.filter((t) => t.setup === setup);
    const groups = detailsFor(settings, setup)
      .map((g) => ({ g, rows: pnlByField(trades, g.key, g.options) }))
      .filter((x) => x.rows.length);
    return { setup, trades, groups };
  }).filter((b) => b.groups.length);

  el.innerHTML = `
    <header class="page-head"><h1 class="page-title">Stats</h1></header>
    <div class="segmented" role="group" aria-label="Period">
      ${PERIODS.map(([k, label]) => `<button type="button" data-period="${k}" aria-pressed="${period === k}">${label}</button>`).join('')}
    </div>
    <div class="swipe-area" data-swipe><div class="swipe-content" data-swipe-content>
    ${rules.drawdown ? rulesHtml({ drawdown: rules.drawdown }, 'form-block') : ''}
    ${!list.length ? `
      <div class="card form-block"><div class="empty"><strong>No trades ${all.length ? 'in this period' : 'yet'}</strong>
        ${all.length ? 'Swipe or pick a longer period.' : 'Stats appear once you log trades.'}
        ${all.length ? '' : '<a class="btn btn-primary empty-cta" href="#/trade/new">Log a trade</a>'}</div></div>` : `
    <section class="card equity-card form-block">
      <div class="curve-tip" data-tip hidden></div>
      <div class="equity-head">
        <div>
          <div class="label">Net P&amp;L · ${rangeLabel(days)}</div>
          <div class="equity-net ${tone(s.net)}">${money(s.net)}</div>
        </div>
        <div class="equity-days">${days.length} day${days.length === 1 ? '' : 's'}</div>
      </div>
      <div data-curve></div>
      <div class="equity-axis">
        <span>${shortDate(days[0].day)}</span>
        ${days.length > 2 ? `<span>${shortDate(days[Math.floor((days.length - 1) / 2)].day)}</span>` : ''}
        <span>${shortDate(days[days.length - 1].day)}</span>
      </div>
    </section>

    <div class="tiles">
      <div class="card tile"><div class="label">Win rate</div>
        <div class="big">${pct(s.winRate)}</div>
        <div class="sub">${s.wins} W · ${s.losses} L${s.breakeven ? ` · ${s.breakeven} BE` : ''}</div></div>
      <div class="card tile"><div class="label">Profit factor</div>
        <div class="big">${ratio(s.profitFactor)}</div>
        <div class="sub">${dollars(s.grossWins)} won / ${dollars(s.grossLosses)} lost</div></div>
      <div class="card tile"><div class="label">Avg win / loss</div>
        <div class="two"><span class="pos">${money(s.avgWin)}</span><br><span class="neg">${money(s.avgLoss)}</span></div></div>
      <div class="card tile"><div class="label">Expectancy</div>
        <div class="big ${tone(s.expectancy)}">${money(s.expectancy)}</div>
        <div class="sub">per trade · ${s.count} trade${s.count === 1 ? '' : 's'}</div></div>
      <div class="card tile"><div class="label">Max drawdown</div>
        <div class="big ${tone(dd.amount)}">${money(dd.amount)}</div>
        <div class="sub">${dd.amount < 0 ? `${dd.peakAt ? shortDate(dd.peakAt) : 'Start'} → ${shortDate(dd.troughAt)}` : 'No drawdown'}</div></div>
      <div class="card tile"><div class="label">Best / worst day</div>
        <div class="two"><span class="${tone(bw.best.net)}">${money(bw.best.net)}</span><br><span class="${tone(bw.worst.net)}">${money(bw.worst.net)}</span></div>
        <div class="sub">${shortDate(bw.best.day)} / ${shortDate(bw.worst.day)}</div></div>
    </div>

    <section class="card card-pad">
      <h2 class="bars-title">By entry reason</h2>
      ${barsHtml(setups, (r) => r.setup, (r) => r.net, (r) => r.count)}
    </section>

    <section class="card card-pad">
      <h2 class="bars-title">By time of day</h2>
      ${barsHtml(hours, (r) => hourLabel(r.key), (r) => r.net, (r) => r.count, winOf)}
      <p class="note">Hour the trade was entered, in this phone’s time zone.</p>
    </section>

    <section class="card card-pad">
      <h2 class="bars-title">By weekday</h2>
      ${barsHtml(weekdays, (r) => DOW[r.key], (r) => r.net, (r) => r.count, winOf)}
    </section>

    ${breakdowns.map((b) => `
    <section class="card card-pad">
      <h2 class="bars-title"><span>${esc(b.setup)}</span><span class="num ${tone(summarize(b.trades).net)}">${money(summarize(b.trades).net)}</span></h2>
      ${b.groups.map(({ g, rows }) => `
        <p class="detail-label">${esc(g.label)}</p>
        ${barsHtml(rows, (r) => r.value, (r) => r.net, (r) => r.count, winOf)}`).join('')}
    </section>`).join('')}

    <section class="card card-pad">
      <h2 class="bars-title"><span>Cost of mistakes</span>${mistakes.length ? `<span class="num neg">${money(mistakeTotal)}</span>` : ''}</h2>
      ${mistakes.length
        ? barsHtml(mistakes, (r) => r.mistake, (r) => r.cost, (r) => r.count)
        : '<p class="muted" style="margin:0">No losing trades tagged with a mistake in this period.</p>'}
      ${mistakes.length ? '<p class="note">Sum of net P&amp;L of losing trades tagged with each mistake. A trade with two mistakes counts toward both.</p>' : ''}
    </section>`}
    </div></div>`;

  const curveEl = el.querySelector('[data-curve]');
  if (curveEl) {
    curveEl.innerHTML = curveSvg(curve, Math.max(200, Math.round(curveEl.clientWidth)));
    scrubber(curveEl, el.querySelector('[data-tip]'));
  }

  const keys = PERIODS.map(([k]) => k);
  const setPeriod = (k) => {
    if (!k || k === period) return;
    slideDir = keys.indexOf(k) > keys.indexOf(period) ? 1 : -1;
    period = k;
    refresh();
  };
  const content = el.querySelector('[data-swipe-content]');
  slideIn(content, slideDir);
  slideDir = 0;
  pageSwipe(el.querySelector('[data-swipe]'), content, {
    canGo: (dir) => !!keys[keys.indexOf(period) + dir],
    onSwipe: (dir) => setPeriod(keys[keys.indexOf(period) + dir]),
    shouldStart: (e) => !e.target.closest('[data-curve]'),
  });

  el.onclick = (e) => {
    const b = e.target.closest('[data-period]');
    if (b) setPeriod(b.dataset.period);
  };
}

/** Touch or hover the curve to see the balance at that day. */
function scrubber(curveEl, tip) {
  const svg = curveEl.querySelector('svg');
  const cursor = svg.querySelector('[data-cursor]');
  const line = cursor.querySelector('line');
  const dot = cursor.querySelector('circle');
  const g = geometry;
  const show = (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * g.width;
    let i = 0;
    for (let k = 1; k < g.pts.length; k++) if (Math.abs(g.x(k) - px) < Math.abs(g.x(i) - px)) i = k;
    const p = g.pts[i];
    cursor.style.display = '';
    line.setAttribute('x1', g.x(i));
    line.setAttribute('x2', g.x(i));
    dot.setAttribute('cx', g.x(i));
    dot.setAttribute('cy', g.y(p.equity));
    const dayNet = p.equity - (i > 0 ? g.pts[i - 1].equity : 0);
    tip.hidden = false;
    tip.innerHTML = p.day
      ? `<b class="num ${tone(p.equity)}">${money(p.equity)}</b><span>${shortDate(p.day)} · day <span class="num ${tone(dayNet)}">${money(dayNet)}</span></span>`
      : '<b class="num">$0.00</b><span>Start</span>';
    const left = (g.x(i) / g.width) * rect.width;
    tip.style.left = `${Math.min(Math.max(left, 80), rect.width - 80) + (rect.left - curveEl.parentElement.getBoundingClientRect().left)}px`;
  };
  const hide = () => { cursor.style.display = 'none'; tip.hidden = true; };
  curveEl.addEventListener('pointerdown', show);
  curveEl.addEventListener('pointermove', (e) => { if (e.pointerType === 'mouse' || e.buttons) show(e); });
  curveEl.addEventListener('pointerup', (e) => { if (e.pointerType !== 'mouse') hide(); });
  curveEl.addEventListener('pointercancel', hide);
  curveEl.addEventListener('pointerleave', hide);
}
