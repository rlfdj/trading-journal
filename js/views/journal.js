// Journal (home): month summary, filters, sorting, and the trade list —
// grouped by day on phones (swipe a trade left for Duplicate / Delete) and a
// sortable table on wide screens.

import * as store from '../store.js';
import { enrich, summarize, inPeriod, periodRange, inRange, dayKey, keyDate, dailyPnl, round2 } from '../calc.js';
import {
  money, moneyPlain, moneyCompact, pts, signed, rMult, pct, ratio, tone, dayLabel, shortDate, time, monthName, daysAgo, price, esc,
} from '../format.js';
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
  sort: 'new',          // see SORTS
};

const SORTS = {
  new: ['Newest first', (a, b) => (a.dateTime < b.dateTime ? 1 : -1)],
  old: ['Oldest first', (a, b) => (a.dateTime < b.dateTime ? -1 : 1)],
  best: ['Best P&L', (a, b) => b.m.net - a.m.net],
  worst: ['Worst P&L', (a, b) => a.m.net - b.m.net],
  r: ['Highest R', (a, b) => (b.m.r ?? -Infinity) - (a.m.r ?? -Infinity)],
};
const byDate = () => state.sort === 'new' || state.sort === 'old';

// Long histories render a page at a time so the list stays fast.
const PAGE = 150;
let limit = PAGE;
let limitFor = '';   // filters the current limit applies to; any change starts over

/** Wide screens get the table layout (the sidebar starts earlier, at 960px). */
export const wideQuery = matchMedia('(min-width: 1100px)');

/** "+$98" / "−$1.2k" — whole dollars for tight spaces. */
const moneyShort = (x) => (x ? `${x > 0 ? '+' : '\u2212'}$${moneyCompact(Math.abs(x)).replace(/^\+/, '')}` : '$0');
let backupBannerHidden = false;
const ACTIONS_W = 156; // width of the Duplicate + Delete buttons behind a row
let openRow = null;    // the row currently swiped open

/** "Strong Trend · EMA · Shallow" for a trade's setup details, or ''. */
export function detailText(t, settings) {
  return detailsFor(settings, t.setup).map((g) => t[g.key]).filter(Boolean).join(' · ');
}

export function tradeRowHtml(t, settings, { showDate = false } = {}) {
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
          <span class="num">${showDate ? `${shortDate(t.dateTime)} ` : ''}${time(t.dateTime)}</span><span>· ${t.contracts} ${esc(t.instrument)}</span>
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

const filterCount = (settings) => filterKeys(settings).filter((k) => state[k]).length + (state.sort !== 'new' ? 1 : 0);

export async function render(el, { settings, params, go, refresh }) {
  const trades = enrich(await store.listTrades(), settings);
  openRow = null;
  const now = new Date();
  const month = summarize(inPeriod(trades, 'month', now));
  const todayNet = round2(trades.filter((t) => dayKey(t.dateTime) === dayKey(now)).reduce((a, t) => a + t.m.net, 0));
  const weekNet = round2(inRange(trades, periodRange('week', 0, now)).reduce((a, t) => a + t.m.net, 0));
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
      <button class="icon-btn" data-act="filter" aria-label="Filter and sort trades">${icons.filter}</button>
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
      <div class="hero-top"><span>${monthName(keyDate(dayKey(now)).getMonth())} net P&amp;L</span>
        <span>${month.count} trade${month.count === 1 ? '' : 's'}</span></div>
      <div class="hero-net num ${tone(month.net)}">${money(month.net)}</div>
      ${sparkline(monthTrades)}
      <div class="hero-stats">
        <div><span>Today</span><b class="${tone(todayNet)}">${moneyShort(todayNet)}</b></div>
        <div><span>This week</span><b class="${tone(weekNet)}">${moneyShort(weekNet)}</b></div>
        <div><span>Win rate</span><b>${pct(month.winRate)}</b></div>
        <div><span>Profit factor</span><b>${ratio(month.profitFactor)}</b></div>
      </div>
    </section>
    <div class="chips journal-filters" role="toolbar" aria-label="Show"></div>
    <div class="active-filters" data-active hidden></div>
    <div data-list></div>`;

  const chipsEl = el.querySelector('.journal-filters');
  const listEl = el.querySelector('[data-list]');

  function drawChips() {
    const chips = [['all', 'All'], ['wins', 'Wins'], ['losses', 'Losses'], ...setups.map((s) => [`setup:${s}`, s])];
    chipsEl.innerHTML = chips.map(([k, label]) =>
      `<button class="chip" data-chip="${esc(k)}" aria-pressed="${state.chip === k}">${esc(label)}</button>`).join('');
  }

  /** One removable pill per active filter, sort and search, plus Clear all. */
  function drawActive() {
    const box = el.querySelector('[data-active]');
    const pills = filterKeys(settings).filter((k) => state[k]).map((k) => [k, k === 'grade' ? `Grade ${state[k]}` : state[k]]);
    if (state.query.trim()) pills.push(['query', `“${state.query.trim()}”`]);
    if (state.sort !== 'new') pills.push(['sort', SORTS[state.sort][0]]);
    box.hidden = !pills.length;
    const filterBtn = el.querySelector('[data-act="filter"]');
    filterBtn.querySelector('.dot')?.remove();
    if (filterCount(settings)) filterBtn.insertAdjacentHTML('beforeend', '<span class="dot"></span>');
    box.innerHTML = pills.map(([k, label]) =>
      `<button class="pill" data-unset="${esc(k)}" aria-label="Remove ${esc(label)}">${esc(label)} ${icons.close}</button>`).join('')
      + (pills.length > 1 ? '<button class="link-btn small" data-act="clear-filters">Clear all</button>' : '');
  }

  function drawList() {
    drawActive();
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
    shown.sort(SORTS[state.sort][1]);
    const summary = summarize(shown);
    const head = `<p class="list-summary"><span>${shown.length} of ${trades.length} trades</span>
      <span class="num ${tone(summary.net)}">${money(summary.net)}</span></p>`;

    const sig = JSON.stringify([state.chip, state.query, state.sort, ...filterKeys(settings).map((k) => state[k])]);
    if (sig !== limitFor) { limitFor = sig; limit = PAGE; }
    // A day opened from the Calendar must be on the page.
    if (pendingDay) {
      const last = shown.map((t) => dayKey(t.dateTime)).lastIndexOf(pendingDay);
      if (last >= limit) limit = last + 1;
    }
    let n = Math.min(limit, shown.length);
    // Never cut a day in half when grouped by date.
    if (byDate()) while (n < shown.length && dayKey(shown[n].dateTime) === dayKey(shown[n - 1].dateTime)) n++;
    const page = shown.slice(0, n);
    const rest = shown.length - n;
    const more = rest ? `<button class="btn btn-soft btn-block show-more" data-act="more">Show ${Math.min(PAGE, rest)} more · ${rest} left</button>` : '';

    if (wideQuery.matches) { listEl.innerHTML = head + tableHtml(page) + more; return; }
    if (!byDate()) {
      // Sorted by result: one flat list, each row shows its date.
      listEl.innerHTML = `${head}<div class="card trade-list">${page.map((t) => rowHtml(t, true)).join('')}</div>${more}`;
      listEl.querySelectorAll('.swipe-row').forEach(swipeRow);
      return;
    }
    const groups = [];
    for (const t of page) {
      const k = dayKey(t.dateTime);
      if (!groups.length || groups[groups.length - 1].key !== k) groups.push({ key: k, trades: [] });
      groups[groups.length - 1].trades.push(t);
    }
    listEl.innerHTML = groups.map((g) => `
      <section id="day-${g.key}">
        <h2 class="day-head"><span>${dayLabel(g.key)} ${dayWL(g.trades)}</span>
          <span class="num ${tone(dayNet.get(g.key))}">${money(dayNet.get(g.key))}</span></h2>
        <div class="card trade-list">${g.trades.map((t) => rowHtml(t, false)).join('')}</div>
      </section>`).join('') + more;
    if (filtered()) listEl.insertAdjacentHTML('afterbegin', head);
    listEl.querySelectorAll('.swipe-row').forEach(swipeRow);
  }

  const filtered = () => state.chip !== 'all' || filterCount(settings) > 0 || state.query.trim();

  function rowHtml(t, showDate) {
    return `
      <div class="swipe-row" data-row="${esc(t.id)}">
        <div class="row-behind">
          <button type="button" class="row-act" data-dup="${esc(t.id)}" tabindex="-1">${icons.copy}<span>Duplicate</span></button>
          <button type="button" class="row-act danger" data-del="${esc(t.id)}" tabindex="-1">${icons.trash}<span>Delete</span></button>
        </div>
        ${tradeRowHtml(t, settings, { showDate })}
      </div>`;
  }

  /** Desktop: dense, sortable table. Day subtotal rows when sorted by date. */
  function tableHtml(list) {
    const th = (label, key, cls = '') => {
      const on = key && (state.sort === key || (key === 'new' && state.sort === 'old'));
      const next = key === 'new' ? (state.sort === 'new' ? 'old' : 'new') : key;
      return `<th class="${cls}" ${on ? `aria-sort="${state.sort === 'old' || state.sort === 'worst' ? 'ascending' : 'descending'}"` : ''}>${key
        ? `<button class="th-sort" data-sort="${next}">${label}${on ? ` <span aria-hidden="true">${state.sort === 'old' ? '↑' : '↓'}</span>` : ''}</button>` : label}</th>`;
    };
    let body = '';
    let lastDay = null;
    for (const t of list) {
      const k = dayKey(t.dateTime);
      if (byDate() && k !== lastDay) {
        const n = dayNet.get(k);
        body += `<tr class="day-row"><td colspan="8">${dayLabel(k)} ${dayWL(list.filter((x) => dayKey(x.dateTime) === k))}</td>
          <td class="opt"></td><td class="r num ${tone(n)}">${money(n)}</td><td class="opt"></td><td></td></tr>`;
        lastDay = k;
      }
      const tick = (settings.instruments.find((i) => i.symbol === t.instrument) || {}).tickSize || 0.25;
      const details = detailText(t, settings);
      const mistakes = t.mistakes || [];
      body += `<tr class="res-${tone(t.m.net)}" data-id="${esc(t.id)}" tabindex="0">
        <td class="num">${byDate() ? '' : `${shortDate(t.dateTime)} `}${time(t.dateTime)}</td>
        <td><span class="badge badge-${t.side}">${t.side === 'short' ? 'S' : 'L'}</span></td>
        <td class="setup-cell">${esc(t.setup || '—')}${details ? `<div class="sub">${esc(details)}</div>` : ''}</td>
        <td class="r num">${t.contracts}</td>
        <td class="r num">${price(t.entry, tick)}</td>
        <td class="r num">${price(t.exit, tick)}</td>
        <td class="r num ${tone(t.m.points)}">${signed(t.m.points)}</td>
        <td class="r num ${t.m.r === null ? 'muted' : tone(t.m.r)}">${t.m.r === null ? '—' : rMult(t.m.r)}</td>
        <td class="r num muted opt">${moneyPlain(t.m.fees)}</td>
        <td class="r num strong ${tone(t.m.net)}">${money(t.m.net)}</td>
        <td class="c num opt">${esc(t.grade || '—')}</td>
        <td class="tags-cell">${mistakes.map((m) => `<span class="tag tag-mistake">${esc(m)}</span>`).join(' ')}${t.sample ? ' <span class="tag tag-sample">SAMPLE</span>' : ''}</td>
      </tr>`;
    }
    return `<div class="card table-wrap"><table class="trade-table">
      <thead><tr>
        ${th(byDate() ? 'Time' : 'Date', 'new')}${th('Side')}${th('Entry reason')}${th('Qty', null, 'r')}
        ${th('Entry', null, 'r')}${th('Exit', null, 'r')}${th('Points', null, 'r')}
        ${th('R', 'r', 'r')}${th('Fees', null, 'r opt')}${th('Net', state.sort === 'best' ? 'worst' : 'best', 'r')}${th('Grade', null, 'c opt')}${th('Mistakes')}
      </tr></thead><tbody>${body}</tbody></table></div>`;
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

  const pendingDay = params.get('day');
  drawChips();
  drawList();
  // Keyboard: Enter on a table row opens it.
  el.onkeydown = (e) => {
    const tr = e.target.closest && e.target.closest('tr[data-id]');
    if (tr && e.key === 'Enter') go(`#/trade/${tr.dataset.id}`);
  };

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
    const sortBtn = e.target.closest('[data-sort]');
    if (sortBtn) { state.sort = sortBtn.dataset.sort; drawList(); return; }
    const unset = e.target.closest('[data-unset]');
    if (unset) {
      const k = unset.dataset.unset;
      if (k === 'query') { state.query = ''; state.searchOpen = false; refresh(); return; }
      if (k === 'sort') state.sort = 'new';
      else state[k] = null;
      drawList();
      return;
    }
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
    } else if (act === 'more') {
      limit += PAGE;
      const y = window.scrollY;
      drawList();
      window.scrollTo(0, y);
    } else if (act === 'clear-filters') {
      state.chip = 'all';
      state.query = '';
      state.sort = 'new';
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
  return sheet('Filter & sort', (body, close) => {
    const draw = () => {
      body.innerHTML = `
        <p class="section-label">Sort</p>
        <div class="chips wrap">${Object.entries(SORTS).map(([k, [label]]) =>
          `<button class="chip" data-sortk="${k}" aria-pressed="${state.sort === k}">${label}</button>`).join('')}</div>
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
      const sk = e.target.closest('[data-sortk]');
      if (sk) { state.sort = sk.dataset.sortk; draw(); return; }
      const chip = e.target.closest('[data-k]');
      if (chip) { state[chip.dataset.k] = chip.dataset.v || null; draw(); return; }
      if (e.target.closest('[data-clear]')) { filterKeys(settings).forEach((k) => { state[k] = null; }); state.sort = 'new'; close(); }
      if (e.target.closest('[data-done]')) close();
    };
  });
}
