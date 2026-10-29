// Journal (home): month summary, filters, trades grouped by day.
// Swipe a trade left for Duplicate / Delete (with Undo).

import * as store from '../store.js';
import { enrich, summarize, inPeriod, dayKey, dailyPnl } from '../calc.js';
import { money, pts, rMult, pct, ratio, tone, dayLabel, time, monthName, daysAgo, esc } from '../format.js';
import { icons, sheet, toast } from '../ui.js';
import { drag } from '../gestures.js';
import { exportJsonBackup } from '../backup.js';
import { detailsFor, allDetails } from '../defaults.js';

const BASE_FILTERS = ['instrument', 'grade', 'mistake'];
const filterKeys = (settings) => [...BASE_FILTERS, ...allDetails(settings).map((g) => g.key)];

// Kept between renders so filters survive opening and closing a trade.
const state = {
  chip: 'all',          // 'all' | 'wins' | 'losses' | 'setup:<name>'
  searchOpen: false,
  query: '',
  instrument: null,
  grade: null,
  mistake: null,
  // plus one key per setup detail (trend, pullbackTo, depth), added as used
};
let backupBannerHidden = false;
const ACTIONS_W = 156; // width of the Duplicate + Delete buttons behind a row
let openRow = null;    // the row currently swiped open

/** "Strong Trend · EMA · Shallow" for a trade's setup details, or ''. */
export function detailText(t, settings) {
  return detailsFor(settings, t.setup).map((g) => t[g.key]).filter(Boolean).join(' · ');
}

export function tradeRowHtml(t, settings) {
  const mistakes = t.mistakes || [];
  const details = detailText(t, settings);
  return `
    <button class="trade-row res-${tone(t.m.net)}" data-id="${esc(t.id)}">
      <div class="trade-main">
        <div class="trade-line1">
          <span class="badge badge-${t.side}">${t.side === 'short' ? 'SHORT' : 'LONG'}</span>
          <span class="setup">${esc(t.setup || 'No setup')}</span>
        </div>
        <div class="trade-line2">
          <span class="num">${time(t.dateTime)}</span><span>· ${t.contracts} ${esc(t.instrument)}</span>
          ${mistakes.length ? `<span class="tag tag-mistake">${esc(mistakes[0])}${mistakes.length > 1 ? ` +${mistakes.length - 1}` : ''}</span>` : ''}
          ${t.sample ? '<span class="tag tag-sample">SAMPLE</span>' : ''}
        </div>
        ${details ? `<div class="trade-line3">${esc(details)}</div>` : ''}
      </div>
      <div class="trade-nums">
        <div class="trade-net ${tone(t.m.net)}">${money(t.m.net)}</div>
        <div class="trade-pts">${pts(t.m.points)}</div>
        ${t.m.r !== null ? `<div class="trade-r num ${tone(t.m.r)}">${rMult(t.m.r)}</div>` : ''}
      </div>
    </button>`;
}

export const EMPTY_ART = `<svg class="empty-art" viewBox="0 0 120 72" aria-hidden="true">
  <rect x="1" y="1" width="118" height="70" rx="14" fill="var(--card)" stroke="var(--line)"/>
  <path d="M14 54 L36 40 L52 46 L74 24 L90 32 L106 16" fill="none" stroke="var(--pos)" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
  <circle cx="106" cy="16" r="4" fill="var(--pos)"/>
  <path d="M14 62 H106" stroke="var(--line)" stroke-dasharray="3 4"/>
</svg>`;

/** "2W 1L" for a day's trades. */
function dayWL(list) {
  const w = list.filter((t) => t.m.net > 0).length;
  const l = list.filter((t) => t.m.net < 0).length;
  return `<span class="day-wl num">${w}W ${l}L</span>`;
}

/** Small cumulative-P&L line for the hero card. */
function sparkline(list) {
  if (list.length < 2) return '';
  const sorted = [...list].sort((a, b) => (a.dateTime < b.dateTime ? -1 : 1));
  let eq = 0;
  const pts = [0, ...sorted.map((t) => (eq += t.m.net))];
  const W = 300, H = 44, pad = 3;
  const min = Math.min(...pts), max = Math.max(...pts), span = max - min || 1;
  const x = (i) => (i * W) / (pts.length - 1);
  const y = (v) => pad + (H - pad * 2) * (1 - (v - min) / span);
  const line = pts.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ');
  return `<svg class="hero-spark" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
    <line x1="0" x2="${W}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="spark-zero"/>
    <path d="${line}" class="spark-line" vector-effect="non-scaling-stroke"/></svg>`;
}

/** Animate the hero number up from 0 the first time it's shown this session. */
let counted = false;
function countUp(node) {
  if (!node || counted || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  counted = true;
  const target = Number(node.dataset.count) || 0;
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / 650);
    node.textContent = money(Math.round(target * (1 - (1 - k) ** 3) * 100) / 100);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function matches(t, settings) {
  if (state.chip === 'wins' && !(t.m.net > 0)) return false;
  if (state.chip === 'losses' && !(t.m.net < 0)) return false;
  if (state.chip.startsWith('setup:') && t.setup !== state.chip.slice(6)) return false;
  if (state.instrument && t.instrument !== state.instrument) return false;
  if (state.grade && t.grade !== state.grade) return false;
  if (state.mistake && !(t.mistakes || []).includes(state.mistake)) return false;
  if (allDetails(settings).some((g) => state[g.key] && t[g.key] !== state[g.key])) return false;
  const q = state.query.trim().toLowerCase();
  if (q) {
    const hay = [t.setup, t.notes, t.instrument, t.side, t.grade, ...(t.mistakes || []),
      detailText(t, settings)].join(' ').toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

const filterCount = (settings) => filterKeys(settings).filter((k) => state[k]).length;

export async function render(el, { settings, params, go, refresh }) {
  const trades = enrich(await store.listTrades(), settings);
  openRow = null;
  const now = new Date();
  const month = summarize(inPeriod(trades, 'month', now));
  const monthInstruments = [...new Set(inPeriod(trades, 'month', now).map((t) => t.instrument))];
  const dayNet = new Map(dailyPnl(trades).map((d) => [d.day, d.net]));
  const monthTrades = inPeriod(trades, 'month', now);
  const setups = [...new Set([...settings.setups, ...trades.map((t) => t.setup).filter(Boolean)])];
  if (state.chip.startsWith('setup:') && !setups.includes(state.chip.slice(6))) state.chip = 'all';

  const needsBackup = trades.some((t) => !t.sample)
    && (!settings.lastBackupAt || daysAgo(settings.lastBackupAt) > 7) && !backupBannerHidden;

  el.innerHTML = `
    <header class="page-head">
      <div class="title-wrap"><h1 class="page-title">Journal</h1>
        <div class="page-sub">${now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}</div></div>
      <button class="icon-btn" data-act="search" aria-label="Search trades" aria-expanded="${state.searchOpen}">${icons.search}</button>
      <button class="icon-btn" data-act="filter" aria-label="Filter trades">${icons.filter}${filterCount(settings) ? '<span class="dot"></span>' : ''}</button>
    </header>
    ${state.searchOpen ? `
      <div class="search-row">
        <input class="input" type="search" data-search placeholder="Search setup, notes, mistakes" value="${esc(state.query)}" enterkeyhint="search">
      </div>` : ''}
    ${settings.sampleLoaded ? `
      <div class="banner banner-warn"><p><b>Sample data is on.</b> Turn it off in Settings to remove it.</p></div>` : ''}
    ${needsBackup ? `
      <div class="banner"><p>${settings.lastBackupAt
        ? `Last backup was ${daysAgo(settings.lastBackupAt)} days ago.`
        : 'You haven’t backed up yet.'} Your journal only lives on this phone.</p>
        <button class="btn btn-primary" data-act="backup">Back up</button>
        <button class="icon-btn bare" data-act="hide-backup" aria-label="Remind me later">${icons.close}</button>
      </div>` : ''}
    <section class="hero hero-${tone(month.net)}" aria-label="This month">
      <div class="hero-top"><span>${monthName(now.getMonth())} · Net P&amp;L</span>
        <span class="num">${esc(monthInstruments.join(' · ') || settings.defaultInstrument)}</span></div>
      <div class="hero-net num ${tone(month.net)}" data-count="${month.net}">${money(month.net)}</div>
      ${sparkline(monthTrades)}
      <div class="hero-stats">
        <div><span>Win rate</span><b>${pct(month.winRate)}</b></div>
        <div><span>Trades</span><b>${month.count}</b></div>
        <div><span>Profit factor</span><b>${ratio(month.profitFactor)}</b></div>
      </div>
    </section>
    <div class="chips journal-filters" role="toolbar" aria-label="Show"></div>
    <div data-list></div>`;

  const chipsEl = el.querySelector('.journal-filters');
  const listEl = el.querySelector('[data-list]');

  function drawChips() {
    const chips = [['all', 'All'], ['wins', 'Wins'], ['losses', 'Losses'], ...setups.map((s) => [`setup:${s}`, s])];
    chipsEl.innerHTML = chips.map(([k, label]) =>
      `<button class="chip" data-chip="${esc(k)}" aria-pressed="${state.chip === k}">${esc(label)}</button>`).join('');
  }

  function drawList() {
    if (!trades.length) {
      listEl.innerHTML = `<div class="empty">${EMPTY_ART}<strong>No trades yet</strong>Log your first trade, or import a spreadsheet in Settings.
        <a class="btn btn-primary empty-cta" href="#/trade/new">Log a trade</a></div>`;
      return;
    }
    const shown = trades.filter((t) => matches(t, settings));
    if (!shown.length) {
      listEl.innerHTML = `<div class="empty"><strong>No matching trades</strong>Try another filter.
        <button class="btn btn-soft empty-cta" data-act="clear-filters">Show all trades</button></div>`;
      return;
    }
    const groups = [];
    for (const t of shown) {
      const k = dayKey(t.dateTime);
      if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, trades: [] });
      groups[groups.length - 1].trades.push(t);
    }
    listEl.innerHTML = groups.map((g) => `
      <section id="day-${g.key}">
        <h2 class="day-head"><span>${dayLabel(g.key)} ${dayWL(g.trades)}</span>
          <span class="num ${tone(dayNet.get(g.key))}">${money(dayNet.get(g.key))}</span></h2>
        <div class="card trade-list">${g.trades.map((t) => `
          <div class="swipe-row" data-row="${esc(t.id)}">
            <div class="row-behind">
              <button type="button" class="row-act" data-dup="${esc(t.id)}">${icons.copy}<span>Duplicate</span></button>
              <button type="button" class="row-act danger" data-del="${esc(t.id)}">${icons.trash}<span>Delete</span></button>
            </div>
            ${tradeRowHtml(t, settings)}
          </div>`).join('')}</div>
      </section>`).join('');
    listEl.querySelectorAll('.swipe-row').forEach(swipeRow);
  }

  function setOffset(row, x, animate = true) {
    const front = row.querySelector('.trade-row');
    front.style.transition = animate ? '' : 'none';
    front.style.transform = x ? `translateX(${x}px)` : '';
    row.classList.toggle('open', x !== 0);
  }

  function closeOpenRow() {
    if (openRow) { setOffset(openRow, 0); openRow = null; return true; }
    return false;
  }

  function swipeRow(row) {
    let base = 0;
    drag(row, {
      axis: 'x',
      shouldStart: () => {
        base = openRow === row ? -ACTIONS_W : 0;
        return true;
      },
      move(dx) {
        if (openRow && openRow !== row) closeOpenRow();
        let x = base + dx;
        if (x > 0) x = x / 4;
        if (x < -ACTIONS_W) x = -ACTIONS_W + (x + ACTIONS_W) / 4;
        setOffset(row, x, false);
      },
      end({ dx, vx, cancelled }) {
        const x = base + dx;
        const open = !cancelled && (x < -ACTIONS_W / 2 || (vx < -0.4 && dx < -20)) && !(vx > 0.4);
        setOffset(row, open ? -ACTIONS_W : 0);
        openRow = open ? row : null;
      },
    });
  }

  async function removeTrade(id) {
    const row = listEl.querySelector(`[data-row="${CSS.escape(id)}"]`);
    if (row) row.classList.add('removing');
    openRow = null;
    const removed = await store.deleteTrade(id);
    setTimeout(refresh, row ? 180 : 0);
    toast('Trade deleted', {
      action: 'Undo',
      onAction: async () => { await store.restoreTrade(removed); toast('Trade restored'); refresh(); },
    });
  }

  drawChips();
  drawList();
  countUp(el.querySelector('[data-count]'));

  const search = el.querySelector('[data-search]');
  if (search) {
    search.oninput = () => { state.query = search.value; drawList(); };
    if (!state.query) search.focus();
  }

  el.onclick = async (e) => {
    const dup = e.target.closest('[data-dup]');
    if (dup) { closeOpenRow(); go(`#/trade/new?copy=${encodeURIComponent(dup.dataset.dup)}`); return; }
    const del = e.target.closest('[data-del]');
    if (del) { await removeTrade(del.dataset.del); return; }
    // A tap anywhere while a row is open just closes it.
    if (closeOpenRow()) return;
    const row = e.target.closest('[data-id]');
    if (row) { go(`#/trade/${row.dataset.id}`); return; }
    const chip = e.target.closest('[data-chip]');
    if (chip) { state.chip = chip.dataset.chip; drawChips(); drawList(); return; }
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (act === 'search') {
      state.searchOpen = !state.searchOpen;
      if (!state.searchOpen) state.query = '';
      refresh();
    } else if (act === 'filter') {
      await openFilters(settings, trades);
      refresh();
    } else if (act === 'backup') {
      if (await exportJsonBackup()) refresh();
    } else if (act === 'clear-filters') {
      state.chip = 'all';
      state.query = '';
      filterKeys(settings).forEach((k) => { state[k] = null; });
      refresh();
    } else if (act === 'hide-backup') {
      backupBannerHidden = true;
      refresh();
    }
  };

  const day = params.get('day');
  if (day) {
    const target = el.querySelector(`#day-${CSS.escape(day)}`);
    if (target) requestAnimationFrame(() => window.scrollTo(0, target.getBoundingClientRect().top + window.scrollY - 12));
  }
}

function openFilters(settings, trades) {
  const instruments = [...new Set(trades.map((t) => t.instrument))];
  const mistakes = [...new Set([...settings.mistakes, ...trades.flatMap((t) => t.mistakes || [])])];
  const group = (label, key, options) => `
    <p class="section-label">${label}</p>
    <div class="chips wrap">
      <button class="chip" data-k="${key}" data-v="" aria-pressed="${!state[key]}">Any</button>
      ${options.map((o) => `<button class="chip" data-k="${key}" data-v="${esc(o)}" aria-pressed="${state[key] === o}">${esc(o)}</button>`).join('')}
    </div>`;
  return sheet('Filter trades', (body, close) => {
    const draw = () => {
      body.innerHTML = `
        ${instruments.length > 1 ? group('Instrument', 'instrument', instruments) : ''}
        ${allDetails(settings).map((g) => group(esc(g.label), g.key, g.options)).join('')}
        ${group('Grade', 'grade', ['A', 'B', 'C', 'D'])}
        ${group('Mistake', 'mistake', mistakes)}
        <div style="height:16px"></div>
        <button class="btn btn-primary btn-block" data-done>Done</button>
        <button class="btn btn-ghost btn-block" data-clear>Clear filters</button>`;
    };
    draw();
    body.onclick = (e) => {
      const chip = e.target.closest('[data-k]');
      if (chip) { state[chip.dataset.k] = chip.dataset.v || null; draw(); return; }
      if (e.target.closest('[data-clear]')) { filterKeys(settings).forEach((k) => { state[k] = null; }); close(); }
      if (e.target.closest('[data-done]')) close();
    };
  });
}
