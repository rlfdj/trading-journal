// sample.js — fake trades for trying the app. Every sample trade has sample: true
// and a fixed id, so turning sample data off (or on again) never touches real trades.

import * as store from './store.js';
import { feesFor } from './calc.js';
import { detailsFor } from './defaults.js';

const SETUPS = ['Trend Pullback', 'Trend Pullback', 'Disconnect Fade', 'Range Fade'];
const MISTAKES = ['Early entry', 'Oversized', 'Moved stop', 'Chased', 'Cut winner'];
const NOTES = ['', '', 'Clean break of the opening range.', 'Waited for the retest.', 'Took it too early, no confirmation.', 'Followed the plan.', ''];

/** Small seeded PRNG so the sample set is the same every time. */
function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sampleId = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const tick = (x) => Math.round(x * 4) / 4;

function build(settings) {
  const rand = rng(42);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];
  const trades = [];
  const today = new Date();
  let price = 25600;
  let n = 0;
  // About 8 weeks of weekdays, ending yesterday.
  for (let back = 56; back >= 1; back--) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - back);
    if (day.getDay() === 0 || day.getDay() === 6) continue;
    if (rand() < 0.15) continue; // some days off
    const count = 1 + Math.floor(rand() * 3);
    price = tick(price + (rand() - 0.45) * 120);
    let minute = 9 * 60 + 35 + Math.floor(rand() * 20);
    for (let k = 0; k < count; k++) {
      n++;
      const side = rand() < 0.55 ? 'long' : 'short';
      const contracts = rand() < 0.15 ? 3 : rand() < 0.5 ? 2 : 1;
      const riskPts = tick(6 + rand() * 10);
      const win = rand() < 0.56;
      const movePts = win ? tick(riskPts * (0.6 + rand() * 2.2)) : -tick(riskPts * (0.4 + rand() * 0.7));
      const entry = tick(price + (rand() - 0.5) * 30);
      const dir = side === 'long' ? 1 : -1;
      const exit = tick(entry + dir * movePts);
      const stop = rand() < 0.85 ? tick(entry - dir * riskPts) : null;
      const target = rand() < 0.5 ? tick(entry + dir * riskPts * 2) : null;
      const mistakes = [];
      if (!win && rand() < 0.6) mistakes.push(pick(MISTAKES));
      if (contracts === 3 && rand() < 0.5 && !mistakes.includes('Oversized')) mistakes.push('Oversized');
      if (win && rand() < 0.1) mistakes.push('Cut winner');
      const when = new Date(day);
      when.setHours(0, minute, 0, 0);
      minute += 20 + Math.floor(rand() * 110);
      const setup = pick(SETUPS);
      const details = Object.fromEntries(detailsFor(settings, setup).map((g) => [g.key, pick(g.options)]));
      trades.push({
        id: sampleId(n),
        sample: true,
        dateTime: when.toISOString(),
        instrument: 'MNQ',
        side,
        contracts,
        entry,
        exit,
        stop,
        target,
        setup,
        ...details,
        mistakes,
        grade: win ? pick(['A', 'A', 'B', 'B', 'C']) : pick(['B', 'C', 'C', 'D']),
        notes: pick(NOTES),
        screenshotIds: [],
        fees: feesFor(settings, 'MNQ', contracts),
        deleted: false,
      });
    }
  }
  return trades;
}

export async function loadSample() {
  const settings = await store.getSettings();
  for (const t of build(settings)) {
    const existing = await store.getTrade(t.id);
    await store.saveTrade(existing ? { ...t, createdAt: existing.createdAt } : t);
  }
  await store.saveSettings({ ...settings, sampleLoaded: true });
}

export async function removeSample() {
  const all = await store.listTrades();
  for (const t of all) if (t.sample) await store.deleteTrade(t.id);
  const settings = await store.getSettings();
  await store.saveSettings({ ...settings, sampleLoaded: false });
}
