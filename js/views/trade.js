// Log / edit trade — full-screen form shown over the tabs.

import * as store from '../store.js';
import { tradeMetrics, findInstrument, feesFor, isOnTick, hasNum, dayKey } from '../calc.js';
import {
  money, moneyPlain, signed, rMult, tone, price, dayLabel, time, toLocalInput, fromLocalInput, fromDayKey, esc,
} from '../format.js';
import { icons, toast, confirmSheet, promptSheet } from '../ui.js';
import { compressImage } from '../image.js';
import { detailsFor, allDetails } from '../defaults.js';

const PRICE_FIELDS = ['entry', 'exit', 'stop', 'target'];
let objectUrls = [];

/** Free image memory when the form closes. */
export function teardown() {
  objectUrls.forEach((u) => URL.revokeObjectURL(u));
  objectUrls = [];
}

function toNum(s) {
  const v = String(s ?? '').trim().replace(',', '.');
  return v === '' ? null : Number(v);
}

function newTrade(settings, params) {
  const enabled = settings.instruments.filter((i) => i.enabled);
  const inst = enabled.find((i) => i.symbol === settings.defaultInstrument) || enabled[0] || settings.instruments[0];
  let when = new Date();
  const day = params.get('day');
  if (day && /^\d{4}-\d{2}-\d{2}$/.test(day) && day !== dayKey(when)) {
    const d = fromDayKey(day);
    d.setHours(when.getHours(), when.getMinutes());
    when = d;
  }
  when.setSeconds(0, 0);
  return {
    instrument: inst.symbol,
    dateTime: when.toISOString(),
    side: 'long',
    contracts: 1,
    entry: null, exit: null, stop: null, target: null,
    setup: '',
    mistakes: [],
    grade: '',
    notes: '',
    screenshotIds: [],
    fees: feesFor(settings, inst.symbol, 1),
  };
}

export async function render(el, { id, params, settings, close }) {
  teardown();
  const existing = id ? await store.getTrade(id) : null;
  if (id && !existing) {
    el.innerHTML = `<div class="form-view"><div class="form-head"><button class="link-btn" data-cancel>Back</button><h1>Trade</h1><span></span></div>
      <div class="empty"><strong>Trade not found</strong>It may have been deleted.</div></div>`;
    el.querySelector('[data-cancel]').onclick = close;
    return;
  }

  const t = existing ? structuredClone(existing) : newTrade(settings, params);
  // Price inputs are edited as text so "25812." doesn't get mangled mid-typing.
  const text = Object.fromEntries(PRICE_FIELDS.map((f) => [f, hasNum(t[f]) ? String(t[f]) : '']));
  let feesText = Number(t.fees ?? 0).toFixed(2);
  let feesManual = existing ? Number(existing.fees) !== feesFor(settings, existing.instrument, existing.contracts) : false;
  const shots = (t.screenshotIds || []).map((sid) => ({ id: sid, url: null }));
  const removedShots = [];
  const errors = {};
  let saving = false;

  const snapshot = () => JSON.stringify([t, text, feesText, shots.map((s) => s.id || s.url)]);
  const initial = snapshot();

  const instruments = settings.instruments.filter((i) => i.enabled || i.symbol === t.instrument);
  const inst = () => findInstrument(settings, t.instrument) || instruments[0];
  const setups = () => [...new Set([...settings.setups, t.setup].filter(Boolean))];
  const mistakes = () => [...new Set([...settings.mistakes, ...t.mistakes])];

  el.innerHTML = `
    <div class="form-view">
      <header class="form-head">
        <button class="link-btn" data-cancel>Cancel</button>
        <h1>${existing ? 'Edit trade' : 'New trade'}</h1>
        <button class="link-btn" data-save>Save</button>
      </header>

      <div class="card inst-card">
        <div class="inst-row">
          <div class="inst-name"><span data-inst-name></span></div>
          <span class="inst-pv" data-pv></span>
          <select class="overlay-input" data-inst aria-label="Instrument">
            ${instruments.map((i) => `<option value="${esc(i.symbol)}" ${i.symbol === t.instrument ? 'selected' : ''}>${esc(i.symbol)} · ${esc(i.name)}</option>`).join('')}
          </select>
        </div>
        <div class="inst-row inst-date-row">
          ${icons.calendar}
          <span class="inst-date" data-date-label></span>
          <span class="inst-change">Change</span>
          <input class="overlay-input" type="datetime-local" data-date aria-label="Trade date and time" value="${toLocalInput(t.dateTime)}">
        </div>
      </div>

      <div class="segmented form-block" role="group" aria-label="Side" data-side>
        <button type="button" data-v="long">Long</button>
        <button type="button" data-v="short">Short</button>
      </div>

      <div class="card stepper-card form-block">
        <span id="contracts-label">Contracts</span>
        <div class="stepper" role="group" aria-labelledby="contracts-label">
          <button type="button" data-step="-1" aria-label="One fewer contract">−</button>
          <output data-contracts aria-live="polite"></output>
          <button type="button" data-step="1" aria-label="One more contract">+</button>
        </div>
      </div>

      <div class="grid2 form-block">
        ${PRICE_FIELDS.map((f) => `
          <label class="field">
            <span class="field-label">${f[0].toUpperCase() + f.slice(1)}${f === 'stop' || f === 'target' ? ' <small>(optional)</small>' : ''}</span>
            <input class="input num" data-price="${f}" inputmode="decimal" autocomplete="off" enterkeyhint="next" value="${esc(text[f])}">
            <p class="field-error" data-error="${f}"></p>
          </label>`).join('')}
      </div>

      <div class="result-card form-block" data-result aria-live="polite"></div>

      <div class="card card-pad fees-row form-block">
        <label class="field-label" for="fees">Fees <small data-fees-hint></small></label>
        <button type="button" class="link-btn" data-fees-reset hidden>Reset</button>
        <input class="input num" id="fees" data-fees inputmode="decimal" autocomplete="off" value="${esc(feesText)}">
      </div>

      <p class="section-label">Entry reason</p>
      <div class="chips wrap" data-setups></div>

      <div class="setup-details" data-details></div>

      <p class="section-label">Mistakes</p>
      <div class="chips wrap" data-mistakes></div>

      <p class="section-label">Grade</p>
      <div class="segmented grade" role="group" aria-label="Grade" data-grade>
        ${['A', 'B', 'C', 'D'].map((g) => `<button type="button" data-v="${g}">${g}</button>`).join('')}
      </div>

      <p class="section-label">Notes</p>
      <textarea class="input" data-notes rows="4" placeholder="What did you see? What would you repeat?">${esc(t.notes)}</textarea>

      <p class="section-label">Chart</p>
      <div class="shots" data-shots></div>
      <label class="btn btn-block file-btn">${icons.camera}<span data-shot-label>Add chart screenshot</span>
        <input type="file" accept="image/*" multiple data-file aria-label="Add chart screenshot">
      </label>

      ${existing ? '<button type="button" class="btn btn-block btn-outline-danger form-block" data-delete>Delete trade</button>' : ''}
    </div>
    <div class="save-bar"><button class="btn btn-primary btn-block" data-save>Save trade</button></div>`;

  const $ = (s) => el.querySelector(s);

  // ------------------------------------------------------------- drawing

  function drawInstrument() {
    const i = inst();
    $('[data-inst-name]').innerHTML = `<b>${esc(i.symbol)}</b> <span>· ${esc(i.name)}</span>`;
    $('[data-pv]').textContent = `$${i.pointValue} / pt`;
    $('[data-date-label]').textContent = `${dayLabel(t.dateTime)} · ${time(t.dateTime)}`;
  }

  function drawPressed(container, isOn) {
    container.querySelectorAll('[data-v]').forEach((b) => b.setAttribute('aria-pressed', String(isOn(b.dataset.v))));
  }

  function drawChips() {
    $('[data-setups]').innerHTML = setups().map((s) =>
      `<button type="button" class="chip" data-setup="${esc(s)}" aria-pressed="${t.setup === s}">${esc(s)}</button>`).join('')
      + '<button type="button" class="chip add" data-new="setup">+ New</button>';
    $('[data-mistakes]').innerHTML = mistakes().map((m) =>
      `<button type="button" class="chip" data-mistake="${esc(m)}" aria-pressed="${t.mistakes.includes(m)}">${esc(m)}</button>`).join('')
      + '<button type="button" class="chip add" data-new="mistake">+ New</button>';
  }

  function drawDetails() {
    const groups = detailsFor(settings, t.setup);
    const box = $('[data-details]');
    box.hidden = !groups.length;
    box.innerHTML = groups.map((g) => `
      <p class="detail-label" id="detail-${g.key}">${esc(g.label)}</p>
      <div class="chips wrap" role="group" aria-labelledby="detail-${g.key}" data-detail="${esc(g.key)}">
        ${g.options.map((o) => `<button type="button" class="chip" data-v="${esc(o)}" aria-pressed="${t[g.key] === o}">${esc(o)}</button>`).join('')}
      </div>`).join('');
  }

  function drawFees() {
    const auto = feesFor(settings, t.instrument, t.contracts);
    $('[data-fees-hint]').textContent = feesManual ? `(auto ${moneyPlain(auto)})` : '(auto)';
    $('[data-fees-reset]').hidden = !feesManual;
  }

  function current() {
    const out = { ...t };
    for (const f of PRICE_FIELDS) out[f] = toNum(text[f]);
    out.fees = toNum(feesText) ?? 0;
    return out;
  }

  function drawResult() {
    const c = current();
    const card = $('[data-result]');
    if (!hasNum(c.entry) || !hasNum(c.exit)) {
      card.className = 'result-card form-block';
      card.innerHTML = `<div class="label">Result</div>
        <div class="result-net num muted">—</div>
        <div class="result-grid"><div><span>Points</span><b>—</b></div><div><span>R multiple</span><b>—</b></div><div><span>Risk</span><b>${riskOnly(c)}</b></div></div>
        <div class="result-foot">Enter entry and exit to see P&amp;L</div>`;
      return;
    }
    const m = tradeMetrics(c, inst());
    card.className = `result-card form-block ${tone(m.net)}`;
    card.innerHTML = `<div class="label">Result</div>
      <div class="result-net ${tone(m.net)}">${money(m.net)}</div>
      <div class="result-grid">
        <div><span>Points</span><b>${signed(m.points)}</b></div>
        <div><span>R multiple</span><b>${rMult(m.r)}</b></div>
        <div><span>Risk</span><b>${moneyPlain(m.risk)}</b></div>
      </div>
      <div class="result-foot">Gross ${money(m.gross)} · Fees ${moneyPlain(m.fees)}</div>`;
  }

  function riskOnly(c) {
    if (!hasNum(c.entry) || !hasNum(c.stop)) return '—';
    const m = tradeMetrics({ ...c, exit: c.entry }, inst());
    return moneyPlain(m.risk);
  }

  function validateField(f) {
    const raw = text[f].trim();
    const v = toNum(raw);
    const tick = inst().tickSize;
    let msg = '';
    if (raw === '') msg = (f === 'entry' || f === 'exit') ? 'Required' : '';
    else if (!Number.isFinite(v) || v <= 0) msg = 'Enter a price';
    else if (!isOnTick(v, tick)) msg = `Not on a ${tick} tick`;
    errors[f] = msg;
    $(`[data-error="${f}"]`).textContent = msg;
    $(`[data-price="${f}"]`).classList.toggle('invalid', !!msg);
    return !msg;
  }

  function drawShots() {
    $('[data-shots]').innerHTML = shots.map((s, i) => `
      <div class="shot">
        ${s.url ? `<img src="${s.url}" alt="Chart screenshot ${i + 1}">` : ''}
        <button type="button" class="shot-open" data-open="${i}" aria-label="View screenshot ${i + 1}"></button>
        <button type="button" class="shot-remove" data-remove="${i}" aria-label="Remove screenshot ${i + 1}"><span>${icons.close}</span></button>
      </div>`).join('');
  }

  async function loadShots() {
    for (const s of shots) {
      if (s.url || !s.id) continue;
      const blob = await store.getScreenshot(s.id);
      if (blob) { s.url = URL.createObjectURL(blob); objectUrls.push(s.url); }
    }
    drawShots();
  }

  drawInstrument();
  drawPressed($('[data-side]'), (v) => v === t.side);
  $('[data-contracts]').textContent = t.contracts;
  drawPressed($('[data-grade]'), (v) => v === t.grade);
  drawDetails();
  drawChips();
  drawFees();
  drawResult();
  drawShots();
  loadShots();

  // ------------------------------------------------------------- events

  $('[data-inst]').onchange = (e) => {
    t.instrument = e.target.value;
    drawInstrument();
    PRICE_FIELDS.forEach((f) => { if (text[f] || errors[f]) validateField(f); });
    drawResult();
  };
  $('[data-date]').onchange = (e) => {
    const iso = fromLocalInput(e.target.value);
    if (iso) { t.dateTime = iso; drawInstrument(); }
  };
  el.querySelectorAll('[data-price]').forEach((input) => {
    const f = input.dataset.price;
    input.oninput = () => {
      text[f] = input.value;
      if (errors[f]) validateField(f);
      drawResult();
    };
    input.onblur = () => {
      if (!text[f].trim()) { if (f !== 'entry' && f !== 'exit') validateField(f); return; }
      if (validateField(f)) {
        input.value = text[f] = price(toNum(text[f]), inst().tickSize);
      }
    };
  });
  $('[data-fees]').oninput = (e) => {
    feesText = e.target.value;
    feesManual = true;
    drawFees();
    drawResult();
  };
  $('[data-fees-reset]').onclick = () => {
    feesManual = false;
    feesText = feesFor(settings, t.instrument, t.contracts).toFixed(2);
    $('[data-fees]').value = feesText;
    drawFees();
    drawResult();
  };
  $('[data-notes]').oninput = (e) => { t.notes = e.target.value; };

  $('[data-file]').onchange = async (e) => {
    const files = [...e.target.files];
    e.target.value = '';
    if (!files.length) return;
    const label = $('[data-shot-label]');
    label.textContent = 'Processing…';
    try {
      for (const file of files) {
        const blob = await compressImage(file);
        const url = URL.createObjectURL(blob);
        objectUrls.push(url);
        shots.push({ id: null, blob, url });
      }
    } catch (err) {
      toast(err.message);
    }
    label.textContent = 'Add chart screenshot';
    drawShots();
  };

  el.onclick = async (e) => {
    const target = e.target;
    const side = target.closest('[data-side] [data-v]');
    if (side) {
      t.side = side.dataset.v;
      drawPressed($('[data-side]'), (v) => v === t.side);
      drawResult();
      return;
    }
    const step = target.closest('[data-step]');
    if (step) {
      t.contracts = Math.max(1, Math.min(999, t.contracts + Number(step.dataset.step)));
      $('[data-contracts]').textContent = t.contracts;
      if (!feesManual) {
        feesText = feesFor(settings, t.instrument, t.contracts).toFixed(2);
        $('[data-fees]').value = feesText;
      }
      drawFees();
      drawResult();
      return;
    }
    const grade = target.closest('[data-grade] [data-v]');
    if (grade) {
      t.grade = t.grade === grade.dataset.v ? '' : grade.dataset.v;
      drawPressed($('[data-grade]'), (v) => v === t.grade);
      return;
    }
    const detail = target.closest('[data-detail] [data-v]');
    if (detail) {
      const group = detail.closest('[data-detail]');
      const key = group.dataset.detail;
      t[key] = t[key] === detail.dataset.v ? '' : detail.dataset.v;
      drawPressed(group, (v) => v === t[key]);
      return;
    }
    const setup = target.closest('[data-setup]');
    if (setup) {
      t.setup = t.setup === setup.dataset.setup ? '' : setup.dataset.setup;
      drawChips();
      drawDetails();
      return;
    }
    const mistake = target.closest('[data-mistake]');
    if (mistake) {
      const m = mistake.dataset.mistake;
      t.mistakes = t.mistakes.includes(m) ? t.mistakes.filter((x) => x !== m) : [...t.mistakes, m];
      drawChips();
      return;
    }
    const add = target.closest('[data-new]');
    if (add) { await addTag(add.dataset.new); return; }
    const open = target.closest('[data-open]');
    if (open) { viewShot(shots[Number(open.dataset.open)]); return; }
    const remove = target.closest('[data-remove]');
    if (remove) {
      const [s] = shots.splice(Number(remove.dataset.remove), 1);
      if (s.id) removedShots.push(s.id);
      drawShots();
      return;
    }
    if (target.closest('[data-save]')) { await save(); return; }
    if (target.closest('[data-cancel]')) { await cancel(); return; }
    if (target.closest('[data-delete]')) await remove_();
  };

  async function addTag(kind) {
    const listKey = kind === 'setup' ? 'setups' : 'mistakes';
    const name = await promptSheet({
      title: kind === 'setup' ? 'New entry reason' : 'New mistake',
      label: 'Name',
      submitLabel: 'Add',
      validate: (v) => (!v ? 'Enter a name' : settings[listKey].includes(v) ? 'Already in the list' : null),
    });
    if (!name) return;
    settings[listKey] = [...settings[listKey], name];
    await store.saveSettings(settings);
    if (kind === 'setup') t.setup = name;
    else t.mistakes = [...t.mistakes, name];
    drawChips();
  }

  function viewShot(s) {
    if (!s || !s.url) return;
    const v = document.createElement('div');
    v.className = 'viewer';
    v.innerHTML = `<img src="${s.url}" alt="Chart screenshot"><button class="icon-btn" aria-label="Close">${icons.close}</button>`;
    v.onclick = () => v.remove();
    document.body.appendChild(v);
  }

  async function save() {
    if (saving) return;
    const ok = PRICE_FIELDS.map(validateField).every(Boolean);
    const fees = toNum(feesText);
    if (!(fees === null || (Number.isFinite(fees) && fees >= 0))) {
      toast('Fees must be a positive number');
      return;
    }
    if (!ok) {
      const first = PRICE_FIELDS.find((f) => errors[f]);
      $(`[data-price="${first}"]`).scrollIntoView({ block: 'center', behavior: 'smooth' });
      toast('Check the highlighted prices');
      return;
    }
    saving = true;
    try {
      const ids = [];
      for (const s of shots) ids.push(s.id || await store.saveScreenshot(s.blob));
      for (const sid of removedShots) await store.deleteScreenshot(sid);
      const record = { ...current(), screenshotIds: ids };
      // Keep only the details that belong to the chosen setup.
      const keep = new Set(detailsFor(settings, record.setup).map((g) => g.key));
      for (const g of allDetails(settings)) if (!keep.has(g.key) || !record[g.key]) delete record[g.key];
      record.fees = record.fees ?? 0;
      await store.saveTrade(record);
      toast(existing ? 'Trade updated' : 'Trade saved');
      close();
    } catch (err) {
      saving = false;
      toast(`Could not save: ${err.message}`);
    }
  }

  async function cancel() {
    if (snapshot() !== initial) {
      const discard = await confirmSheet({ title: 'Discard changes?', confirmLabel: 'Discard', danger: true });
      if (!discard) return;
    }
    close();
  }

  async function remove_() {
    const yes = await confirmSheet({
      title: 'Delete this trade?',
      message: `${t.side === 'short' ? 'Short' : 'Long'} ${t.contracts} ${t.instrument} on ${dayLabel(t.dateTime)} at ${time(t.dateTime)}. This can’t be undone.`,
      confirmLabel: 'Delete trade',
      danger: true,
    });
    if (!yes) return;
    await store.deleteTrade(existing.id);
    toast('Trade deleted');
    close();
  }
}
