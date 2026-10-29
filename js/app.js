// app.js — boots the app and routes between screens.
//
// Routes (hash based, so GitHub Pages needs no server config):
//   #/journal[?day=YYYY-MM-DD]  #/calendar  #/stats  #/settings
//   #/trade/new[?day=YYYY-MM-DD]  #/trade/<id>   (full-screen form over the tabs)

import * as store from './store.js';
import { icons, toast } from './ui.js';
import { longPress } from './gestures.js';
import { initPwa } from './pwa.js';
import * as journal from './views/journal.js';
import * as calendar from './views/calendar.js';
import * as stats from './views/stats.js';
import * as settingsView from './views/settings.js';
import * as tradeForm from './views/trade.js';
import { wideQuery } from './views/journal.js';

const views = { journal, calendar, stats, settings: settingsView };

const viewEl = document.getElementById('view');
const overlayEl = document.getElementById('overlay');

let currentTab = null;      // tab rendered in #view
let overlayOpen = false;
let savedScroll = 0;
let routedInApp = false;    // true once we've handled a hash change in this session
let renderToken = 0;
let currentParams = new URLSearchParams();

document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icons[el.dataset.icon]; });

// Long-press + to start from a copy of the most recent trade, timed now.
longPress(document.querySelector('.tab-plus'), async () => {
  const [latest] = await store.listTrades();
  if (!latest) { go('#/trade/new'); return; }
  toast('Copy of your last trade');
  go(`#/trade/new?copy=${encodeURIComponent(latest.id)}&now=1`);
});

function parseHash() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  return { parts: path.split('/').filter(Boolean), params: new URLSearchParams(query || '') };
}

export function go(hash, { replace = false } = {}) {
  if (replace) location.replace(hash);
  else location.hash = hash;
}

async function renderTab(tab, params) {
  const token = ++renderToken;
  currentParams = params;
  const settings = await store.getSettings();
  if (token !== renderToken) return;
  document.querySelectorAll('.tab').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  await views[tab].render(viewEl, { settings, params, go, refresh: () => renderTab(tab, params) });
}

let leaveTimer = null;

async function openOverlay(id, params) {
  if (!overlayOpen) {
    clearTimeout(leaveTimer);
    savedScroll = window.scrollY;
    overlayOpen = true;
    overlayEl.hidden = false;
    overlayEl.classList.remove('leaving');
    overlayEl.style.transform = '';
    overlayEl.style.transition = '';
    overlayEl.scrollTop = 0;
    overlayEl.classList.add('entering');
    overlayEl.addEventListener('animationend', () => overlayEl.classList.remove('entering'), { once: true });
    document.body.classList.add('locked');
  }
  const settings = await store.getSettings();
  await tradeForm.render(overlayEl, { id, params, settings, close: closeTradeForm });
}

function closeOverlay() {
  if (!overlayOpen) return false;
  overlayOpen = false;
  document.body.classList.remove('locked');
  // Slide away (unless a drag already moved it off screen), then clear.
  overlayEl.classList.remove('entering');
  if (!overlayEl.style.transform) overlayEl.classList.add('leaving');
  else overlayEl.style.transition = 'transform 0.2s ease-in';
  const done = () => {
    tradeForm.teardown();
    overlayEl.hidden = true;
    overlayEl.innerHTML = '';
    overlayEl.classList.remove('leaving');
    overlayEl.style.transform = '';
    overlayEl.style.transition = '';
  };
  leaveTimer = setTimeout(done, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
  return true;
}

/** Called by the trade form when it is done (saved, deleted or cancelled). */
function closeTradeForm() {
  if (routedInApp && history.length > 1) history.back();
  else go(`#/${currentTab || 'journal'}`, { replace: true });
}

async function route() {
  const { parts, params } = parseHash();

  if (parts[0] === 'trade') {
    if (!currentTab) { currentTab = 'journal'; await renderTab('journal', new URLSearchParams()); }
    await openOverlay(parts[1] === 'new' || !parts[1] ? null : parts[1], params);
    return;
  }

  const tab = views[parts[0]] ? parts[0] : 'journal';
  const wasOverlay = closeOverlay();
  const sameTab = tab === currentTab;
  const switched = currentTab && !sameTab;
  currentTab = tab;
  await renderTab(tab, params);
  if (switched) {
    viewEl.classList.remove('view-enter');
    void viewEl.offsetWidth; // restart the animation
    viewEl.classList.add('view-enter');
  }
  if (wasOverlay && sameTab) window.scrollTo(0, savedScroll);
  else if (!params.get('day')) window.scrollTo(0, 0);
}

// Crossing the desktop breakpoint switches layouts (e.g. Journal list ↔ table).
wideQuery.addEventListener('change', () => { if (currentTab) renderTab(currentTab, currentParams).catch(showError); });

window.addEventListener('hashchange', () => {
  routedInApp = true;
  route().catch(showError);
});

function showError(err) {
  console.error(err);
  toast(err && err.message ? err.message : 'Something went wrong');
}
window.addEventListener('unhandledrejection', (e) => showError(e.reason));

async function boot() {
  try {
    await store.init();
  } catch (err) {
    viewEl.innerHTML = `<div class="empty"><strong>Storage unavailable</strong>
      This browser blocked on-device storage (private browsing?). ${String(err.message || err)}</div>`;
    return;
  }
  if (!location.hash) location.replace('#/journal');
  await route();
  initPwa();
}

boot().catch(showError);
