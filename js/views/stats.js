// Stats: pick a period length (week / month / 3M / all) and step back through
// past periods with the arrows or a sideways swipe. Equity curve (drag along it
// to read any day), key numbers, then breakdowns: strategy → execution → timing.

import * as store from '../store.js';
import {
  enrich, summarize, equityCurve, maxDrawdown, bestWorstDay, pnlBySetup, costOfMistakes, dailyPnl, pnlByField,
  pnlByHour, pnlByWeekday, periodRange, inRange, grossAndFees, averageR, streaks, greenDays, largestTrades,
} from '../calc.js';
import { icons } from '../ui.js';
import { pageSwipe, slideIn } from '../gestures.js';
import { EMPTY_ART, wideQuery } from './journal.js';
import { detailsFor } from '../defaults.js';
import { money, moneyPlain, rMult, pct, ratio, tone, shortDate, monthShort, monthName, esc } from '../format.js';

const PERIODS = [['week', 'Week'], ['month', 'Month'], ['3m', '3M'], ['all', 'All']];
let period = 'month';
let offset = 0;  // 0 = current period, -1 = the one before …
let slideDir = 0;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const hourLabel = (h) => `${String(h).padStart(2, '0')}:00–${String((h + 1) % 24).padStart(2, '0')}:00`;

const winOf = (r) => (r.winRate === null ? '' : ` · ${pct(r.winRate)} win`);
const dollars = (x) => `$${Math.round(Math.abs(x)).toLocaleString('en-US')}`;

let geometry = null; // last drawn curve, for scrubbing

/** Equity curve as inline SVG sized to the card. */
function curveSvg(curve, width, H = 150) {
  const padY = 8, padX = 4;
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
      <defs><linearGradient id="eqfill" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity="0.28"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      <path d="${area}" fill="url(#eqfill)" />
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

/** "October 2026", "Week of Oct 19", "Aug – Oct 2026", "All time". */
function periodLabel(range) {
  if (!range.start) return 'All time';
  const a = range.start;
  const last = new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() - 1);
  if (period === 'week') return offset === 0 ? 'This week' : offset === -1 ? 'Last week' : `Week of ${shortDate(a)}`;
  if (period === 'month') return `${monthName(a.getMonth())} ${a.getFullYear()}`;
  return `${monthShort(a.getMonth())}${a.getFullYear() !== last.getFullYear() ? ` ${a.getFullYear()}` : ''} – ${monthShort(last.getMonth())} ${last.getFullYear()}`;
}

const tile = (label, value, sub = '', cls = '') => `
  <div class="tile"><div class="label">${label}</div><div class="big ${cls}">${value}</div>${sub ? `<div class="sub">${sub}</div>` : ''}</div>`;
const pair = (a, b) => `<span class="${tone(a)}">${money(a)}</span><span class="${tone(b)}">${money(b)}</span>`;

export async function render(el, { settings, refresh }) {
  const all = enrich(await store.listTrades(), settings);
  const range = periodRange(period, offset);
  const list = inRange(all, range);
  const s = summarize(list);
  const gf = grossAndFees(list);
  const ar = averageR(list);
  const st = streaks(list);
  const gd = greenDays(list);
  const big = largestTrades(list);
  const days = dailyPnl(list);
  const curve = equityCurve(list);
  const dd = maxDrawdown(list);
  const bw = bestWorstDay(list);
  const setups = pnlBySetup(list);
  const grades = pnlByField(list, 'grade', ['A', 'B', 'C', 'D']);
  const mistakes = costOfMistakes(list);
  const mistakeTotal = mistakes.reduce((a, m) => a + m.cost, 0);
  const hours = pnlByHour(list);
  const weekdays = pnlByWeekday(list);
  // One breakdown per setup that has details (Trend Pullback).
  const breakdowns = Object.keys(settings.setupDetails || {}).map((setup) => {
    const trades = list.filter((t) => t.setup === setup);
    const groups = detailsFor(settings, setup)
      .map((g) => ({ g, rows: pnlByField(trades, g.key, g.options) }))
      .filter((x) => x.rows.length);
    return { setup, trades, groups };
  }).filter((b) => b.groups.length);
  const stepping = period !== 'all';

  el.innerHTML = `
    <header class="page-head"><h1 class="page-title">Stats</h1></header>
    <div class="segmented" role="group" aria-label="Period length">
      ${PERIODS.map(([k, label]) => `<button type="button" data-period="${k}" aria-pressed="${period === k}">${label}</button>`).join('')}
    </div>
    <div class="period-nav">
      ${stepping ? `<button class="icon-btn bare" data-step="-1" aria-label="Previous period">${icons.left}</button>` : '<span></span>'}
      <span class="period-label">${esc(periodLabel(range))}</span>
      ${stepping ? `<button class="icon-btn bare" data-step="1" aria-label="Next period" ${offset >= 0 ? 'disabled' : ''}>${icons.right}</button>` : '<span></span>'}
    </div>
    <div class="swipe-area" data-swipe><div class="swipe-content" data-swipe-content>
    ${!list.length ? `
      <div class="card"><div class="empty">${EMPTY_ART}<strong>No trades ${all.length ? 'in this period' : 'yet'}</strong>
        ${all.length ? (stepping ? 'Go back a period or pick a longer one.' : '') : 'Stats appear once you log trades.'}
        ${all.length ? '' : '<a class="btn btn-primary empty-cta" href="#/trade/new">Log a trade</a>'}</div></div>` : `
    <div class="stats-top">
    <section class="card equity-card">
      <div class="curve-tip" data-tip hidden></div>
      <div class="equity-head">
        <div>
          <div class="label">Net P&amp;L</div>
          <div class="equity-net ${tone(s.net)}">${money(s.net)}</div>
        </div>
        <div class="equity-days">${s.count} trade${s.count === 1 ? '' : 's'} · ${days.length} day${days.length === 1 ? '' : 's'}</div>
      </div>
      <div class="equity-sub num">Gross ${money(gf.gross)} · Fees ${moneyPlain(gf.fees)}</div>
      <div data-curve></div>
      <div class="equity-axis">
        <span>${shortDate(days[0].day)}</span>
        ${days.length > 2 ? `<span>${shortDate(days[Math.floor((days.length - 1) / 2)].day)}</span>` : ''}
        <span>${shortDate(days[days.length - 1].day)}</span>
      </div>
    </section>

    <section class="card tiles" aria-label="Key numbers">
      ${tile('Win rate', pct(s.winRate), `${s.wins} W · ${s.losses} L${s.breakeven ? ` · ${s.breakeven} BE` : ''}`)}
      ${tile('Profit factor', ratio(s.profitFactor), `${dollars(s.grossWins)} won · ${dollars(s.grossLosses)} lost`)}
      ${tile('Expectancy', money(s.expectancy), 'net per trade', tone(s.expectancy))}
      ${tile('Avg R', ar.avg === null ? '—' : rMult(ar.avg), ar.count ? `${ar.count} of ${s.count} trades have a stop` : 'Add stops to see R', ar.avg === null ? '' : tone(ar.avg))}
      ${tile('Avg win / loss', pair(s.avgWin, s.avgLoss), '', 'two')}
      ${tile('Largest win / loss', pair(big.win ? big.win.m.net : null, big.loss ? big.loss.m.net : null), '', 'two')}
      ${tile('Max drawdown', money(dd.amount), dd.amount < 0 ? `${dd.peakAt ? shortDate(dd.peakAt) : 'Start'} → ${shortDate(dd.troughAt)}` : 'None', tone(dd.amount))}
      ${tile('Best / worst day', pair(bw.best.net, bw.worst.net), `${shortDate(bw.best.day)} · ${shortDate(bw.worst.day)}`, 'two')}
      ${tile('Green days', `${gd.green}/${gd.days}`, pct(gd.days ? gd.green / gd.days : null) + ' of days traded')}
      ${tile('Longest streak', `${st.wins}W · ${st.losses}L`, 'wins · losses in a row')}
    </section>
    </div>

    <div class="stats-sections">
    <section class="card card-pad">
      <h2 class="bars-title">By entry reason</h2>
      ${barsHtml(setups, (r) => r.setup, (r) => r.net, (r) => r.count)}
    </section>

    ${breakdowns.map((b) => `
    <section class="card card-pad">
      <h2 class="bars-title"><span>${esc(b.setup)}</span><span class="num ${tone(summarize(b.trades).net)}">${money(summarize(b.trades).net)}</span></h2>
      ${b.groups.map(({ g, rows }) => `
        <p class="detail-label">${esc(g.label)}</p>
        ${barsHtml(rows, (r) => r.value, (r) => r.net, (r) => r.count, winOf)}`).join('')}
    </section>`).join('')}

    <section class="card card-pad">
      <h2 class="bars-title">By grade</h2>
      ${grades.length ? barsHtml(grades, (r) => `Grade ${r.value}`, (r) => r.net, (r) => r.count, winOf)
        : '<p class="muted" style="margin:0">No graded trades in this period.</p>'}
    </section>

    <section class="card card-pad">
      <h2 class="bars-title"><span>Cost of mistakes</span>${mistakes.length ? `<span class="num neg">${money(mistakeTotal)}</span>` : ''}</h2>
      ${mistakes.length
        ? barsHtml(mistakes, (r) => r.mistake, (r) => r.cost, (r) => r.count)
        : '<p class="muted" style="margin:0">No losing trades tagged with a mistake in this period.</p>'}
      ${mistakes.length ? '<p class="note">Net P&amp;L of losing trades tagged with each mistake. A trade with two mistakes counts toward both.</p>' : ''}
    </section>

    <section class="card card-pad">
      <h2 class="bars-title">By time of day</h2>
      ${barsHtml(hours, (r) => hourLabel(r.key), (r) => r.net, (r) => r.count, winOf)}
      <p class="note">Hour of entry, in this device’s time zone.</p>
    </section>

    <section class="card card-pad">
      <h2 class="bars-title">By weekday</h2>
      ${barsHtml(weekdays, (r) => DOW[r.key], (r) => r.net, (r) => r.count, winOf)}
    </section>
    </div>`}
    </div></div>`;

  const curveEl = el.querySelector('[data-curve]');
  if (curveEl) {
    // On wide screens the curve sits beside the key numbers, so it gets their height.
    curveEl.innerHTML = curveSvg(curve, Math.max(200, Math.round(curveEl.clientWidth)), wideQuery.matches ? 300 : 150);
    scrubber(curveEl, el.querySelector('[data-tip]'));
  }

  const setPeriod = (k) => {
    if (!k || k === period) return;
    period = k;
    offset = 0;
    refresh();
  };
  const step = (dir) => {
    if (!stepping || offset + dir > 0) return;
    offset += dir;
    slideDir = dir;
    refresh();
  };
  const content = el.querySelector('[data-swipe-content]');
  slideIn(content, slideDir);
  slideDir = 0;
  // Swipe = previous / next period of the same length, like the calendar.
  if (stepping) {
    pageSwipe(el.querySelector('[data-swipe]'), content, {
      canGo: (dir) => offset + dir <= 0,
      onSwipe: (dir) => step(dir),
      shouldStart: (e) => !e.target.closest('[data-curve]'),
    });
  }

  el.onclick = (e) => {
    const b = e.target.closest('[data-period]');
    if (b) { setPeriod(b.dataset.period); return; }
    const st_ = e.target.closest('[data-step]');
    if (st_ && !st_.disabled) step(Number(st_.dataset.step));
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
