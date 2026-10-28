// app.js — boots the app and routes between screens.
//
// Routes (hash based, so GitHub Pages needs no server config):
//   #/journal[?day=YYYY-MM-DD]  #/calendar  #/stats  #/settings
//   #/trade/new[?day=YYYY-MM-DD]  #/trade/<id>   (full-screen form over the tabs)

import * as store from './store.js';
import { icons, toast } from './ui.js';
import { initPwa } from './pwa.js';
import * as journal from './views/journal.js';
import * as calendar from './views/calendar.js';
import * as stats from './views/stats.js';
import * as settingsView from './views/settings.js';
import * as tradeForm from './views/trade.js';

const views = { journal, calendar, stats, settings: settingsView };

const viewEl = document.getElementById('view');
const overlayEl = document.getElementById('overlay');

let currentTab = null;      // tab rendered in #view
let overlayOpen = false;
let savedScroll = 0;
let routedInApp = false;    // true once we've handled a hash change in this session
let renderToken = 0;

document.querySelectorAll('[data-icon]').forEach((el) => { el.outerHTML = icons[el.dataset.icon]; });

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
  const settings = await store.getSettings();
  if (token !== renderToken) return;
  document.querySelectorAll('.tab').forEach((a) => {
    if (a.dataset.tab === tab) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  });
  await views[tab].render(viewEl, { settings, params, go, refresh: () => renderTab(tab, params) });
}

async function openOverlay(id, params) {
  if (!overlayOpen) {
    savedScroll = window.scrollY;
    overlayOpen = true;
    overlayEl.hidden = false;
    overlayEl.scrollTop = 0;
    document.body.classList.add('locked');
  }
  const settings = await store.getSettings();
  await tradeForm.render(overlayEl, { id, params, settings, close: closeTradeForm });
}

function closeOverlay() {
  if (!overlayOpen) return false;
  overlayOpen = false;
  tradeForm.teardown();
  overlayEl.hidden = true;
  overlayEl.innerHTML = '';
  document.body.classList.remove('locked');
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
  currentTab = tab;
  await renderTab(tab, params);
  if (wasOverlay && sameTab) window.scrollTo(0, savedScroll);
  else if (!params.get('day')) window.scrollTo(0, 0);
}

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
