// ui.js — small shared UI pieces: icons, toast, bottom sheets.

import { esc } from './format.js';

const svg = (body, size = 22) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const icons = {
  journal: svg('<path d="M9 6h11M9 12h11M9 18h11"/><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none"/><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none"/>'),
  calendar: svg('<rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>'),
  stats: svg('<path d="M4 4v16h16"/><path d="M7 15l4-5 3 3 5-6"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  plus: svg('<path d="M12 5v14M5 12h14"/>', 26),
  search: svg('<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>', 20),
  filter: svg('<path d="M4 7h16M7 12h10M10 17h4"/>', 20),
  left: svg('<path d="M15 5l-7 7 7 7"/>', 20),
  right: svg('<path d="M9 5l7 7-7 7"/>', 20),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>', 18),
  camera: svg('<path d="M4 8.5A2.5 2.5 0 0 1 6.5 6h1.6l1.4-2h5l1.4 2h1.6A2.5 2.5 0 0 1 20 8.5v8a2.5 2.5 0 0 1-2.5 2.5h-11A2.5 2.5 0 0 1 4 16.5z"/><circle cx="12" cy="12.5" r="3.5"/>', 20),
};

// -------------------------------------------------------------------- toast

let toastTimer;
export function toast(message) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ------------------------------------------------------------------- sheets

/**
 * Open a bottom sheet. render(body, close) fills it; close(value) resolves.
 * Tapping the backdrop resolves with null.
 */
export function sheet(title, render) {
  return new Promise((resolve) => {
    const wrap = document.createElement('div');
    wrap.className = 'sheet-wrap';
    wrap.innerHTML = `
      <div class="sheet-backdrop"></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-grip"></div>
        <h2 class="sheet-title">${esc(title)}</h2>
        <div class="sheet-body"></div>
      </div>`;
    document.body.appendChild(wrap);
    requestAnimationFrame(() => wrap.classList.add('open'));
    let done = false;
    const close = (value = null) => {
      if (done) return;
      done = true;
      wrap.classList.remove('open');
      setTimeout(() => wrap.remove(), 220);
      resolve(value);
    };
    wrap.querySelector('.sheet-backdrop').addEventListener('click', () => close(null));
    render(wrap.querySelector('.sheet-body'), close);
  });
}

export function confirmSheet({ title, message = '', confirmLabel = 'Confirm', danger = false }) {
  return sheet(title, (body, close) => {
    body.innerHTML = `
      ${message ? `<p class="sheet-msg">${esc(message)}</p>` : ''}
      <button class="btn ${danger ? 'btn-danger' : 'btn-primary'} btn-block" data-ok>${esc(confirmLabel)}</button>
      <button class="btn btn-ghost btn-block" data-cancel>Cancel</button>`;
    body.querySelector('[data-ok]').onclick = () => close(true);
    body.querySelector('[data-cancel]').onclick = () => close(false);
  }).then((v) => v === true);
}

/**
 * A small form in a sheet. fields: [{name, label, value, inputmode, placeholder}]
 * validate(values) returns an error string or null. Resolves with values or null.
 */
export function formSheet({ title, fields, submitLabel = 'Save', validate }) {
  return sheet(title, (body, close) => {
    body.innerHTML = `
      <form class="sheet-form" novalidate>
        ${fields.map((f) => `
          <label class="field">
            <span class="field-label">${esc(f.label)}</span>
            <input class="input${f.mono ? ' num' : ''}" name="${esc(f.name)}" value="${esc(f.value ?? '')}"
              ${f.inputmode ? `inputmode="${f.inputmode}"` : ''} placeholder="${esc(f.placeholder || '')}"
              autocomplete="off" autocapitalize="${f.autocapitalize || 'sentences'}">
          </label>`).join('')}
        <p class="field-error" data-error></p>
        <button class="btn btn-primary btn-block" type="submit">${esc(submitLabel)}</button>
        <button class="btn btn-ghost btn-block" type="button" data-cancel>Cancel</button>
      </form>`;
    const form = body.querySelector('form');
    const first = form.querySelector('input');
    setTimeout(() => first && first.focus(), 250);
    body.querySelector('[data-cancel]').onclick = () => close(null);
    form.onsubmit = (e) => {
      e.preventDefault();
      const values = Object.fromEntries(fields.map((f) => [f.name, form.elements[f.name].value.trim()]));
      const err = validate ? validate(values) : null;
      if (err) { form.querySelector('[data-error]').textContent = err; return; }
      close(values);
    };
  });
}

export function promptSheet({ title, label, value = '', submitLabel = 'Save', validate }) {
  return formSheet({ title, submitLabel, fields: [{ name: 'v', label, value }], validate: validate && ((v) => validate(v.v)) })
    .then((v) => (v ? v.v : null));
}
