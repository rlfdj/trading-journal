// Calendar: Mon–Fri month grid with weekly totals; tap a day to list its trades.
// Swipe the grid sideways to change month; tap the month name to jump.
// Cells show $ P&L, % of account, trade count or win rate (shading always follows P&L).

import * as store from '../store.js';
import { enrich, dailyPnl, dayKey, round2, pctOfAccount } from '../calc.js';
import { money, moneyCompact, pct, pctSigned, signed, tone, dayLabel, time, monthShort, monthName, esc } from '../format.js';
import { icons, sheet } from '../ui.js';
import { pageSwipe, slideIn } from '../gestures.js';

const today = () => new Date();
let shown = null;     // first day of the month being viewed
let selected = null;  // selected day key
let slideDir = 0;     // direction of the last month change, for the slide-in

const MODES = [['pnl', '$'], ['pct', '%'], ['trades', 'Trades'], ['winrate', 'Win %']];
const MONTH_LABEL = { pnl: 'Month net', pct: 'Month return', trades: 'Trades', winrate: 'Win rate' };

/** Totals for a day, week or month: {net, count, wins, losses}. */
const tally = () => ({ net: 0, count: 0, wins: 0, losses: 0 });
function add(into, t) {
  into.net = round2(into.net + t.m.net);
  into.count++;
  if (t.m.net > 0) into.wins++;
  else if (t.m.net < 0) into.losses++;
}

/** The figure shown for a tally in the current mode, as {text, cls}. */
function figure(mode, s, settings, compact) {
  switch (mode) {
    case 'pct': {
      const p = pctOfAccount(s.net, settings.accountSize);
      // Cells are narrow: drop the % sign there (the toggle says %).
      return { text: compact ? (p === null ? '—' : signed(p, Math.abs(p) >= 10 ? 1 : 2)) : pctSigned(p), cls: tone(s.net) };
    }
    case 'trades':
      return { text: compact ? String(s.count) : `${s.count} trade${s.count === 1 ? '' : 's'}`, cls: 'flat' };
    case 'winrate': {
      const decided = s.wins + s.losses;
      return { text: decided ? pct(s.wins / decided) : '—', cls: 'flat' };
    }
    default:
      return { text: compact ? moneyCompact(s.net) : money(s.net), cls: tone(s.net) };
  }
}

function shade(net, maxAbs) {
  if (!net) return '';
  const r = Math.abs(net) / (maxAbs || 1);
  const level = r > 0.66 ? 3 : r > 0.33 ? 2 : 1;
  return `${net > 0 ? 'p' : 'n'}${level}`;
}

export async function render(el, { settings, go, refresh }) {
  const now = today();
  if (!shown) shown = new Date(now.getFullYear(), now.getMonth(), 1);
  const y = shown.getFullYear();
  const mo = shown.getMonth();
  const monthEnd = new Date(y, mo + 1, 1);

  const trades = enrich(await store.listTrades({ from: shown, to: monthEnd }), settings);
  const days = new Map(dailyPnl(trades).map((d) => [d.day, d]));
  const mode = MODES.some(([k]) => k === settings.calendarMode) ? settings.calendarMode : 'pnl';
  const needsSize = mode === 'pct' && !(settings.accountSize > 0);
  const dayTally = new Map();
  const monthTally = tally();
  for (const t of trades) {
    const k = dayKey(t.dateTime);
    if (!dayTally.has(k)) dayTally.set(k, tally());
    add(dayTally.get(k), t);
    add(monthTally, t);
  }
  const dayList = [...days.values()];
  const up = dayList.filter((d) => d.net > 0).length;
  const down = dayList.filter((d) => d.net < 0).length;
  const maxAbs = Math.max(0, ...dayList.map((d) => Math.abs(d.net)));
  const hasWeekend = trades.some((t) => [0, 6].includes(new Date(t.dateTime).getDay()));
  const todayKey = dayKey(now);

  // Default selection: today if it has trades, else the latest trading day this month.
  if (!selected || !selected.startsWith(`${y}-${String(mo + 1).padStart(2, '0')}`)) {
    selected = days.has(todayKey) ? todayKey : (dayList.length ? dayList[dayList.length - 1].day : null);
  }

  // Rows run Monday→Sunday; Sat/Sun are folded into the week total.
  const first = new Date(y, mo, 1);
  const start = new Date(y, mo, 1 - ((first.getDay() + 6) % 7));
  let cells = '';
  for (let wk = new Date(start); wk < monthEnd; wk.setDate(wk.getDate() + 7)) {
    const week = tally();
    for (let i = 0; i < 7; i++) {
      const d = new Date(wk.getFullYear(), wk.getMonth(), wk.getDate() + i);
      const k = dayKey(d);
      const inMonth = d.getMonth() === mo;
      const info = inMonth ? days.get(k) : null;
      if (info) {
        const s = dayTally.get(k);
        week.net = round2(week.net + s.net);
        week.count += s.count; week.wins += s.wins; week.losses += s.losses;
      }
      if (i > 4) continue;
      if (!inMonth) { cells += `<div class="cal-cell out"><span class="d">${d.getDate()}</span></div>`; continue; }
      const cls = ['cal-cell', info ? shade(info.net, maxAbs) : '', k === todayKey ? 'today' : '', k === selected ? 'selected' : '']
        .filter(Boolean).join(' ');
      const label = `${dayLabel(k)}${info ? `, ${money(info.net)}, ${info.count} trade${info.count === 1 ? '' : 's'}` : ', no trades'}`;
      cells += `<button class="${cls}" data-day="${k}" aria-label="${esc(label)}" aria-pressed="${k === selected}">
        <span class="d">${d.getDate()}</span>
        ${info ? (() => { const f = figure(mode, dayTally.get(k), settings, true); return `<span class="v ${f.cls}">${f.text}</span>`; })()
          : k === todayKey ? '<span class="today-label">today</span>' : ''}
      </button>`;
    }
    const wf = week.count ? figure(mode, week, settings, true) : null;
    cells += `<div class="cal-cell cal-week"><span class="d">WK</span>${wf
      ? `<span class="v ${wf.cls}">${wf.text}</span>` : ''}</div>`;
  }

  const sel = selected ? days.get(selected) : null;
  const selTrades = selected ? trades.filter((t) => dayKey(t.dateTime) === selected).reverse() : [];

  const isThisMonth = y === now.getFullYear() && mo === now.getMonth();
  el.innerHTML = `
    <header class="page-head">
      <h1 class="page-title">Calendar</h1>
      <div class="month-nav">
        <button class="icon-btn bare" data-nav="-1" aria-label="Previous month">${icons.left}</button>
        <button class="label month-pick" data-pick aria-label="Choose month, showing ${monthName(mo)} ${y}">${monthShort(mo)} ${y}</button>
        <button class="icon-btn bare" data-nav="1" aria-label="Next month">${icons.right}</button>
      </div>
    </header>

    <div class="swipe-area" data-swipe>
    <div class="swipe-content" data-swipe-content>
    <section class="card month-sum">
      <div><div class="label">${MONTH_LABEL[mode]}</div>${(() => { const f = figure(mode, monthTally, settings, false); return `<div class="num ${f.cls}">${f.text}</div>`; })()}</div>
      <div class="legend">
        <span><i style="background:var(--pos)"></i>${up} up</span>
        <span><i style="background:var(--neg)"></i>${down} down</span>
      </div>
      ${isThisMonth ? '' : '<button class="chip today-chip" data-today>Today</button>'}
    </section>

    <div class="segmented mini cal-mode" role="group" aria-label="Show in calendar" data-mode>
      ${MODES.map(([k, label]) => `<button type="button" data-v="${k}" aria-pressed="${mode === k}">${label}</button>`).join('')}
    </div>
    ${needsSize ? `<div class="banner form-block"><p>Add your account size (for example 50000) to see % returns.</p>
      <a class="btn btn-primary" href="#/settings">Settings</a></div>` : ''}

    <div class="cal-grid" role="grid" aria-label="${monthShort(mo)} ${y}">
      ${['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Week'].map((d) => `<div class="cal-dow">${d}</div>`).join('')}
      ${cells}
    </div>
    </div>
    </div>
    ${hasWeekend ? '<p class="note">Weekend trades are counted in the week total.</p>' : ''}

    ${selected ? `
    <section class="card day-panel">
      <div class="day-panel-head"><span>${dayLabel(selected)}</span>
        ${sel ? `<span class="num ${tone(sel.net)}">${money(sel.net)}</span>` : ''}</div>
      <div class="count">${selTrades.length ? `${selTrades.length} trade${selTrades.length === 1 ? '' : 's'}` : 'No trades'}</div>
      ${selTrades.map((t) => `
        <button class="mini-row" data-id="${esc(t.id)}">
          <span class="t num">${time(t.dateTime)}</span>
          <span class="s">${t.side === 'short' ? 'S' : 'L'}</span>
          <span class="name">${esc(t.setup || 'No setup')}</span>
          <span class="v num ${tone(t.m.net)}">${money(t.m.net)}</span>
        </button>`).join('')}
      <button class="btn btn-soft btn-block" data-log>+ Log a trade on this day</button>
      ${selTrades.length ? '<button class="btn btn-ghost btn-block" data-journal>Open in Journal</button>' : ''}
    </section>` : ''}`;

  const changeMonth = (target, dir) => {
    shown = target;
    selected = null;
    slideDir = dir;
    refresh();
  };
  const area = el.querySelector('[data-swipe]');
  const content = el.querySelector('[data-swipe-content]');
  slideIn(content, slideDir);
  slideDir = 0;
  pageSwipe(area, content, { onSwipe: (dir) => changeMonth(new Date(y, mo + dir, 1), dir) });

  el.onclick = async (e) => {
    const modeBtn = e.target.closest('[data-mode] [data-v]');
    if (modeBtn) {
      if (modeBtn.dataset.v !== mode) {
        settings.calendarMode = modeBtn.dataset.v;
        await store.saveSettings(settings);
        refresh();
      }
      return;
    }
    const nav = e.target.closest('[data-nav]');
    if (nav) {
      const dir = Number(nav.dataset.nav);
      changeMonth(new Date(y, mo + dir, 1), dir);
      return;
    }
    if (e.target.closest('[data-today]')) {
      const target = new Date(now.getFullYear(), now.getMonth(), 1);
      changeMonth(target, target > shown ? 1 : -1);
      return;
    }
    if (e.target.closest('[data-pick]')) {
      const picked = await pickMonth(y, mo, settings);
      if (picked) changeMonth(picked, picked > shown ? 1 : picked < shown ? -1 : 0);
      return;
    }
    const day = e.target.closest('[data-day]');
    if (day) { selected = day.dataset.day; refresh(); return; }
    const row = e.target.closest('[data-id]');
    if (row) { go(`#/trade/${row.dataset.id}`); return; }
    if (e.target.closest('[data-journal]')) go(`#/journal?day=${selected}`);
    if (e.target.closest('[data-log]')) go(`#/trade/new?day=${selected}`);
  };
}

/** Sheet with a year switcher and 12 months, each showing its net. */
function pickMonth(year, month, settings) {
  const now = today();
  return sheet('Go to month', (body, close) => {
    let yr = year;
    const draw = async () => {
      const trades = enrich(await store.listTrades({ from: new Date(yr, 0, 1), to: new Date(yr + 1, 0, 1) }), settings);
      const byMonth = new Map();
      for (const t of trades) {
        const m = new Date(t.dateTime).getMonth();
        byMonth.set(m, round2((byMonth.get(m) || 0) + t.m.net));
      }
      body.innerHTML = `
        <div class="year-nav">
          <button class="icon-btn bare" data-y="-1" aria-label="Previous year">${icons.left}</button>
          <span class="num">${yr}</span>
          <button class="icon-btn bare" data-y="1" aria-label="Next year">${icons.right}</button>
        </div>
        <div class="month-grid">
          ${[...Array(12).keys()].map((m) => {
            const net = byMonth.get(m);
            const cls = ['month-btn', yr === year && m === month ? 'selected' : '', yr === now.getFullYear() && m === now.getMonth() ? 'current' : ''].filter(Boolean).join(' ');
            return `<button class="${cls}" data-m="${m}"><span>${monthShort(m)}</span>
              <span class="num ${net === undefined ? 'muted' : tone(net)}">${net === undefined ? '—' : moneyCompact(net)}</span></button>`;
          }).join('')}
        </div>
        <button class="btn btn-soft btn-block form-block" data-now>This month</button>`;
    };
    draw();
    body.onclick = (e) => {
      const yb = e.target.closest('[data-y]');
      if (yb) { yr += Number(yb.dataset.y); draw(); return; }
      const mb = e.target.closest('[data-m]');
      if (mb) { close(new Date(yr, Number(mb.dataset.m), 1)); return; }
      if (e.target.closest('[data-now]')) close(new Date(now.getFullYear(), now.getMonth(), 1));
    };
  });
}
