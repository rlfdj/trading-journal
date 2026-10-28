// Settings: instruments, commission, setup/mistake lists, backup & restore, sample data.

import * as store from '../store.js';
import { moneyPlain, shortDate, daysAgo, esc } from '../format.js';
import { toast, sheet, confirmSheet, promptSheet, formSheet } from '../ui.js';
import { exportJsonBackup, exportCsv, pickFile, importJsonFile, importCsvFile } from '../backup.js';
import { loadSample, removeSample } from '../sample.js';
import { getVersion } from '../pwa.js';

const LISTS = { setups: 'Entry reasons', mistakes: 'Mistakes' };

function listCard(key, items, settings) {
  return `
    <p class="section-label">${LISTS[key]}</p>
    <div class="card list">
      ${items.map((name, i) => `
        <div class="list-row">
          <div class="grow">${esc(name)}${key === 'setups' && settings.setupDetails?.[name]
            ? `<div class="sub">${settings.setupDetails[name].map((g) => esc(g.label)).join(' · ')}</div>` : ''}</div>
          <div class="row-actions">
            <button data-rename="${key}" data-i="${i}">Rename</button>
            <button class="danger" data-remove="${key}" data-i="${i}">Delete</button>
          </div>
        </div>`).join('')}
      <button class="list-row add" data-add="${key}">+ Add ${key === 'setups' ? 'entry reason' : 'mistake'}</button>
    </div>`;
}

export async function render(el, { settings, refresh }) {
  const [info, version, trades] = await Promise.all([store.storageInfo(), getVersion(), store.listTrades()]);
  const used = new Set(trades.map((t) => t.instrument));
  const enabled = settings.instruments.filter((i) => i.enabled);
  const last = settings.lastBackupAt;

  el.innerHTML = `
    <header class="page-head"><h1 class="page-title">Settings</h1></header>

    <p class="section-label">Instruments</p>
    <div class="card list">
      ${settings.instruments.map((i, idx) => `
        <div class="list-row">
          <div class="grow"><b>${esc(i.symbol)}</b> · ${esc(i.name)}
            <div class="sub num">$${i.pointValue}/pt · ${i.tickSize} tick</div></div>
          ${!i.builtIn && !used.has(i.symbol) ? `<div class="row-actions"><button class="danger" data-del-inst="${idx}">Delete</button></div>` : ''}
          <label class="switch"><input type="checkbox" data-inst="${idx}" ${i.enabled ? 'checked' : ''} aria-label="Use ${esc(i.symbol)}"><span></span></label>
        </div>`).join('')}
      <div class="list-row">
        <label class="grow" for="def-inst">Default instrument</label>
        <select class="input" id="def-inst" data-default>
          ${enabled.map((i) => `<option value="${esc(i.symbol)}" ${i.symbol === settings.defaultInstrument ? 'selected' : ''}>${esc(i.symbol)}</option>`).join('')}
        </select>
      </div>
      <button class="list-row add" data-add-inst>+ Add instrument</button>
    </div>

    <p class="section-label">Commission</p>
    <div class="card list">
      <div class="list-row">
        <label class="grow" for="commission">Per contract, round trip<div class="sub">All-in. Tradeify MNQ is $1.82. Pre-fills fees on new trades.</div></label>
        <input class="input num" id="commission" inputmode="decimal" data-commission value="${esc(Number(settings.commission).toFixed(2))}">
      </div>
    </div>

    ${listCard('setups', settings.setups, settings)}
    ${listCard('mistakes', settings.mistakes, settings)}

    <p class="section-label">Backup &amp; restore</p>
    <div class="card card-pad">
      <div style="margin-bottom:12px">Last backup: <b>${last ? `${shortDate(last)} (${daysAgo(last) === 0 ? 'today' : `${daysAgo(last)} days ago`})` : 'never'}</b></div>
      <button class="btn btn-primary btn-block" data-act="backup">Back up everything (JSON)</button>
      <div class="btn-grid form-block">
        <button class="btn" data-act="csv">Export CSV</button>
        <button class="btn" data-act="restore">Restore backup</button>
      </div>
      <button class="btn btn-ghost btn-block" data-act="import-csv">Import trades from CSV</button>
      <p class="note">Your journal is stored only on this phone. Deleting the home-screen app or clearing Safari website data erases it. The JSON backup includes screenshots; save it to Files or iCloud Drive. Restoring merges by trade — the newer edit wins.</p>
    </div>

    <p class="section-label">Testing</p>
    <div class="card card-pad test-card">
      <div class="title">For testing only</div>
      <div class="list-row" style="padding-left:0">
        <label class="grow" for="sample">Load sample data<div class="sub">Adds about 70 fake MNQ trades marked SAMPLE. Turning it off removes only those.</div></label>
        <label class="switch"><input type="checkbox" id="sample" data-sample ${settings.sampleLoaded ? 'checked' : ''}><span></span></label>
      </div>
    </div>

    <p class="section-label">About</p>
    <div class="card list">
      <div class="list-row"><div class="grow">App version</div><span class="num muted" style="padding-right:8px">${esc(version || 'dev (no service worker)')}</span></div>
      <div class="list-row"><div class="grow">Storage
        <div class="sub">${info.persisted === true ? 'Protected from automatic cleanup' : info.persisted === false ? 'Not protected — back up regularly' : 'Protection unknown'}${info.usage != null ? ` · ${(info.usage / 1048576).toFixed(1)} MB used` : ''}</div></div></div>
      <div class="list-row"><div class="grow">Trades</div><span class="num muted" style="padding-right:8px">${trades.length}</span></div>
      <a class="list-row" href="tests.html"><div class="grow">Run calculation tests</div><span class="muted" style="padding-right:8px">›</span></a>
    </div>`;

  const save = async (patch, message) => {
    Object.assign(settings, patch);
    await store.saveSettings(settings);
    if (message) toast(message);
  };

  el.querySelectorAll('[data-inst]').forEach((box) => {
    box.onchange = async () => {
      const i = settings.instruments[Number(box.dataset.inst)];
      if (!box.checked && settings.instruments.filter((x) => x.enabled).length === 1) {
        box.checked = true;
        toast('Keep at least one instrument on');
        return;
      }
      i.enabled = box.checked;
      const patch = { instruments: settings.instruments };
      if (!i.enabled && settings.defaultInstrument === i.symbol) {
        patch.defaultInstrument = settings.instruments.find((x) => x.enabled).symbol;
      }
      await save(patch);
      refresh();
    };
  });

  el.querySelector('[data-default]').onchange = (e) => save({ defaultInstrument: e.target.value }, 'Default instrument saved');

  const commission = el.querySelector('[data-commission]');
  commission.onchange = async () => {
    const v = Number(commission.value.replace(',', '.'));
    if (!Number.isFinite(v) || v < 0) { toast('Enter a commission like 1.82'); commission.value = settings.commission; return; }
    await save({ commission: v }, `Commission set to ${moneyPlain(v)} per contract`);
  };

  el.querySelector('[data-sample]').onchange = async (e) => {
    const on = e.target.checked;
    e.target.disabled = true;
    if (on) { await loadSample(); toast('Sample data loaded'); }
    else { await removeSample(); toast('Sample data removed'); }
    refresh();
  };

  el.onclick = async (e) => {
    const t = e.target;
    const add = t.closest('[data-add]');
    if (add) {
      const key = add.dataset.add;
      const name = await promptSheet({
        title: key === 'setups' ? 'New entry reason' : 'New mistake', label: 'Name', submitLabel: 'Add',
        validate: (v) => (!v ? 'Enter a name' : settings[key].includes(v) ? 'Already in the list' : null),
      });
      if (name) { await save({ [key]: [...settings[key], name] }); refresh(); }
      return;
    }
    const ren = t.closest('[data-rename]');
    if (ren) { await renameTag(ren.dataset.rename, Number(ren.dataset.i)); return; }
    const rem = t.closest('[data-remove]');
    if (rem) {
      const key = rem.dataset.remove;
      const name = settings[key][Number(rem.dataset.i)];
      const ok = await confirmSheet({
        title: `Delete “${name}”?`,
        message: 'It disappears from the list. Trades already tagged keep it.',
        confirmLabel: 'Delete', danger: true,
      });
      if (ok) {
        const patch = { [key]: settings[key].filter((x) => x !== name) };
        if (key === 'setups' && settings.setupDetails?.[name]) {
          const { [name]: _gone, ...rest } = settings.setupDetails;
          patch.setupDetails = rest;
        }
        await save(patch);
        refresh();
      }
      return;
    }
    if (t.closest('[data-add-inst]')) { await addInstrument(); return; }
    const delInst = t.closest('[data-del-inst]');
    if (delInst) {
      const i = settings.instruments[Number(delInst.dataset.delInst)];
      if (await confirmSheet({ title: `Delete ${i.symbol}?`, confirmLabel: 'Delete', danger: true })) {
        const instruments = settings.instruments.filter((x) => x !== i);
        const patch = { instruments };
        if (settings.defaultInstrument === i.symbol) patch.defaultInstrument = instruments.find((x) => x.enabled)?.symbol || instruments[0].symbol;
        await save(patch);
        refresh();
      }
      return;
    }
    const act = t.closest('[data-act]')?.dataset.act;
    if (act === 'backup') { if (await exportJsonBackup()) refresh(); }
    else if (act === 'csv') await exportCsv();
    else if (act === 'restore') await restore('.json,application/json', importJsonFile, (r) =>
      `Restored: ${r.added} added, ${r.updated} updated, ${r.unchanged} unchanged`);
    else if (act === 'import-csv') await restore('.csv,text/csv', importCsvFile, (r) =>
      `Imported ${r.imported} trade${r.imported === 1 ? '' : 's'}${r.duplicates ? `, ${r.duplicates} already here` : ''}${r.problems.length ? `, skipped ${r.problems.length}` : ''}`);
  };

  async function restore(accept, importer, summary) {
    const file = await pickFile(accept);
    if (!file) return;
    try {
      const result = await importer(file);
      refresh();
      if (result.problems && result.problems.length) {
        // Row-by-row reasons are too long for a toast; keep them on screen until dismissed.
        await sheet('Import finished', (body, close) => {
          body.innerHTML = `<p class="sheet-msg">${esc(summary(result))}. These rows were not imported:</p>
            <ul class="problem-list">${result.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>
            <p class="note">Fix them in the spreadsheet and import the file again. Rows already imported are skipped.</p>
            <button class="btn btn-primary btn-block" data-ok>OK</button>`;
          body.querySelector('[data-ok]').onclick = () => close();
        });
      } else toast(summary(result));
    } catch (err) {
      toast(err.message);
    }
  }

  async function renameTag(key, i) {
    const old = settings[key][i];
    const name = await promptSheet({
      title: `Rename “${old}”`, label: 'New name', value: old,
      validate: (v) => (!v ? 'Enter a name' : v !== old && settings[key].includes(v) ? 'Already in the list' : null),
    });
    if (!name || name === old) return;
    const list = [...settings[key]];
    list[i] = name;
    const patch = { [key]: list };
    if (key === 'setups' && settings.setupDetails?.[old]) {
      // Its extra choices (trend, pullback to, depth) move with it.
      const { [old]: groups, ...rest } = settings.setupDetails;
      patch.setupDetails = { ...rest, [name]: groups };
    }
    await save(patch);
    // Update trades that use the old name so history stays grouped.
    let changed = 0;
    for (const tr of trades) {
      if (key === 'setups' && tr.setup === old) { await store.saveTrade({ ...tr, setup: name }); changed++; }
      if (key === 'mistakes' && (tr.mistakes || []).includes(old)) {
        await store.saveTrade({ ...tr, mistakes: tr.mistakes.map((m) => (m === old ? name : m)) });
        changed++;
      }
    }
    toast(changed ? `Renamed and updated ${changed} trade${changed === 1 ? '' : 's'}` : 'Renamed');
    refresh();
  }

  async function addInstrument() {
    const v = await formSheet({
      title: 'Add instrument',
      submitLabel: 'Add',
      fields: [
        { name: 'symbol', label: 'Symbol', placeholder: 'M2K', autocapitalize: 'characters' },
        { name: 'name', label: 'Name', placeholder: 'Micro Russell 2000' },
        { name: 'pointValue', label: 'Dollars per point', inputmode: 'decimal', placeholder: '5', mono: true },
        { name: 'tickSize', label: 'Tick size', inputmode: 'decimal', placeholder: '0.1', mono: true },
      ],
      validate: (x) => {
        if (!x.symbol) return 'Enter a symbol';
        if (settings.instruments.some((i) => i.symbol.toUpperCase() === x.symbol.toUpperCase())) return 'That symbol already exists';
        if (!(Number(x.pointValue) > 0)) return 'Dollars per point must be above 0';
        if (!(Number(x.tickSize) > 0)) return 'Tick size must be above 0';
        return null;
      },
    });
    if (!v) return;
    await save({
      instruments: [...settings.instruments, {
        symbol: v.symbol.toUpperCase(), name: v.name || v.symbol.toUpperCase(),
        pointValue: Number(v.pointValue), tickSize: Number(v.tickSize), enabled: true, builtIn: false,
      }],
    }, `${v.symbol.toUpperCase()} added`);
    refresh();
  }
}
