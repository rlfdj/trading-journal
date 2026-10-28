// backup.js — export (JSON, CSV) and import, using the iOS share sheet when available.

import * as store from './store.js';
import { enrich, feesFor, findInstrument, hasNum, isOnTick } from './calc.js';
import { toCsv, parseCsv, parseDateTime } from './csv.js';
import { toast, sheet } from './ui.js';
import { esc } from './format.js';
import { detailsFor } from './defaults.js';

/** CSV value → the tag's own spelling (case-insensitive), or '' if it isn't one of the options. */
const matchOption = (group, v) => group.options.find((o) => o.toLowerCase() === v.toLowerCase()) || '';
/** Use the list's spelling when the CSV matches an existing name in another case. */
const matchName = (list, v) => list.find((o) => o.toLowerCase() === v.toLowerCase()) || v;

const CSV_COLUMNS = [
  'id', 'dateTime', 'instrument', 'side', 'contracts', 'entry', 'exit', 'stop', 'target',
  'setup', 'trend', 'pullbackTo', 'depth', 'mistakes', 'grade', 'fees', 'points', 'grossPnl', 'netPnl', 'rMultiple', 'riskUsd', 'notes',
];

const BOM = String.fromCharCode(0xfeff); // lets Excel detect UTF-8
const stamp = () => new Date().toISOString().slice(0, 10);

/**
 * Hand a file to the share sheet (iPhone) or download it (desktop).
 * Resolves true when the file was shared or downloaded, false if cancelled.
 */
async function deliver(file) {
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: file.name });
      return true;
    } catch (err) {
      if (err.name === 'AbortError') return false;
      if (err.name !== 'NotAllowedError') throw err;
      // The tap "expired" while we built the file: ask for one more tap.
      return sheet('Your file is ready', (body, close) => {
        body.innerHTML = `<p class="sheet-msg">${esc(file.name)}</p>
          <button class="btn btn-primary btn-block" data-share>Save or share…</button>
          <button class="btn btn-ghost btn-block" data-cancel>Cancel</button>`;
        body.querySelector('[data-share]').onclick = () => {
          navigator.share({ files: [file], title: file.name })
            .then(() => close(true), () => close(false));
        };
        body.querySelector('[data-cancel]').onclick = () => close(false);
      }).then((v) => v === true);
    }
  }
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url;
  a.download = file.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

/** Full backup incl. screenshots. Records the backup date on success. */
export async function exportJsonBackup() {
  try {
    const data = await store.exportAll();
    const file = new File([JSON.stringify(data)], `trading-journal-backup-${stamp()}.json`, { type: 'application/json' });
    const done = await deliver(file);
    if (done) {
      const settings = await store.getSettings();
      await store.saveSettings({ ...settings, lastBackupAt: new Date().toISOString() });
      toast('Backup saved');
    }
    return done;
  } catch (err) {
    toast(`Backup failed: ${err.message}`);
    return false;
  }
}

export async function exportCsv() {
  try {
    const settings = await store.getSettings();
    const trades = enrich(await store.listTrades(), settings).reverse(); // oldest first
    const rows = [CSV_COLUMNS, ...trades.map((t) => [
      t.id, t.dateTime, t.instrument, t.side, t.contracts, t.entry, t.exit, t.stop ?? '', t.target ?? '',
      t.setup, t.trend || '', t.pullbackTo || '', t.depth || '', (t.mistakes || []).join('; '), t.grade, t.fees, t.m.points, t.m.gross, t.m.net,
      t.m.r === null ? '' : t.m.r.toFixed(2), t.m.risk ?? '', t.notes,
    ])];
    const file = new File([BOM + toCsv(rows)], `trading-journal-trades-${stamp()}.csv`, { type: 'text/csv' });
    if (await deliver(file)) toast('CSV exported');
  } catch (err) {
    toast(`Export failed: ${err.message}`);
  }
}

/** Let the user pick a file. Must be called from a tap handler. */
export function pickFile(accept) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.style.display = 'none';
    input.onchange = () => { resolve(input.files[0] || null); input.remove(); };
    document.body.appendChild(input);
    input.click();
  });
}

export async function importJsonFile(file) {
  let data;
  try {
    data = JSON.parse(await file.text());
  } catch {
    throw new Error('That file isn’t valid JSON.');
  }
  return store.importAll(data);
}

/** "entry 25900.1 not on 0.25 tick", or '' when every price is on the tick. */
function offTick(trade, inst) {
  for (const f of ['entry', 'exit', 'stop', 'target']) {
    if (hasNum(trade[f]) && !isOnTick(trade[f], inst.tickSize)) return `${f} ${trade[f]} not on ${inst.tickSize} tick`;
  }
  return '';
}

/**
 * Import trades from CSV. Needs columns side, contracts, entry, exit, plus either
 * dateTime or separate date and time columns; the rest are optional. Rows with an id merge by updatedAt like JSON imports
 * (CSV rows count as "now", so they win).
 */
export async function importCsvFile(file) {
  const rows = parseCsv(await file.text());
  if (rows.length < 2) throw new Error('No rows found in that CSV.');
  const head = rows[0].map((h) => h.trim().toLowerCase());
  const col = (name) => head.indexOf(name.toLowerCase());
  for (const need of ['side', 'contracts', 'entry', 'exit']) {
    if (col(need) < 0) throw new Error(`The CSV needs a “${need}” column.`);
  }
  if (col('dateTime') < 0 && (col('date') < 0 || col('time') < 0)) {
    throw new Error('The CSV needs a “dateTime” column, or “date” and “time” columns.');
  }
  const settings = await store.getSettings();
  // Accepts 25812.25, 25,812.25, 25812,25 and $1.82.
  const num = (v) => {
    let x = String(v ?? '').replace(/[$\s]/g, '');
    if (x === '') return null;
    x = x.includes(',') && x.includes('.') ? x.replace(/,/g, '') : x.replace(',', '.');
    return Number(x);
  };
  const problems = [];
  let imported = 0;
  let duplicates = 0;
  // Rows without an id are matched on their contents so re-importing a file doesn't duplicate trades.
  const fingerprint = (t) => [t.dateTime, t.instrument, t.side, t.contracts, Number(t.entry), Number(t.exit)].join('|');
  const known = new Set((await store.listTrades()).map(fingerprint));
  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const get = (name) => (col(name) >= 0 ? (r[col(name)] ?? '').trim() : '');
    const when = parseDateTime(col('dateTime') >= 0 ? get('dateTime') : `${get('date')} ${get('time')}`);
    const side = get('side').toLowerCase();
    const instrument = (get('instrument') || settings.defaultInstrument).toUpperCase();
    const trade = {
      id: get('id') || undefined,
      dateTime: when ? when.toISOString() : null,
      instrument,
      side: ['short', 's', 'sell'].includes(side) ? 'short' : ['long', 'l', 'buy'].includes(side) ? 'long' : null,
      contracts: Math.round(num(get('contracts')) || 0),
      entry: num(get('entry')),
      exit: num(get('exit')),
      stop: num(get('stop')),
      target: num(get('target')),
      setup: get('setup') ? matchName(settings.setups, get('setup')) : '',
      mistakes: get('mistakes').split(/[;|]/).map((s) => s.trim()).filter(Boolean).map((m) => matchName(settings.mistakes, m)),
      grade: /^[A-D]$/i.test(get('grade')) ? get('grade').toUpperCase() : '',
      notes: get('notes'),
      screenshotIds: [],
    };
    for (const g of detailsFor(settings, trade.setup)) {
      const v = matchOption(g, get(g.key));
      if (v) trade[g.key] = v;
    }
    const fees = num(get('fees'));
    trade.fees = hasNum(fees) ? fees : feesFor(settings, instrument, trade.contracts);
    const bad = !trade.dateTime ? 'date/time not understood' : !trade.side ? 'side must be long or short' : trade.contracts < 1 ? 'contracts must be 1 or more'
      : !hasNum(trade.entry) || !hasNum(trade.exit) ? 'entry and exit prices are required'
      : !findInstrument(settings, instrument) ? `unknown instrument ${instrument}`
      : offTick(trade, findInstrument(settings, instrument)) || null;
    if (bad) { problems.push(`row ${i + 1}: ${bad}`); continue; }
    if (trade.id) {
      const existing = await store.getTrade(trade.id);
      if (existing) Object.assign(trade, { createdAt: existing.createdAt, screenshotIds: existing.screenshotIds, sample: existing.sample });
    } else if (known.has(fingerprint(trade))) {
      duplicates++;
      continue;
    }
    known.add(fingerprint(trade));
    await store.saveTrade(trade);
    imported++;
  }
  return { imported, duplicates, problems };
}
