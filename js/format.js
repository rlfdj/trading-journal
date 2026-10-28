// format.js — how numbers and dates are displayed.
// Every signed amount carries + or − so colour is never the only signal.

export const MINUS = '−';

const usd = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function sign(x) {
  return x > 0 ? '+' : x < 0 ? MINUS : '';
}

/** +$1,234.50 / −$17.50 / $0.00 */
export function money(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${sign(x)}$${usd.format(Math.abs(x))}`;
}

/** $33.00 — for amounts that are not profit or loss (risk, fees). */
export function moneyPlain(x) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `$${usd.format(Math.abs(x))}`;
}

/** Whole dollars, short: +142, −65, +1.2k */
export function moneyCompact(x) {
  const a = Math.abs(x);
  const body = a >= 10000 ? `${Math.round(a / 1000)}k`
    : a >= 1000 ? `${(a / 1000).toFixed(1).replace(/\.0$/, '')}k`
    : String(Math.round(a));
  return `${body === '0' ? '' : sign(x)}${body}`;
}

/** +24.25 */
export function signed(x, decimals = 2) {
  if (x === null || x === undefined || Number.isNaN(x)) return '—';
  return `${sign(x)}${Math.abs(x).toFixed(decimals)}`;
}

export const pts = (x) => `${signed(x)} pts`;
export const rMult = (x) => (x === null || x === undefined ? '—' : `${signed(x)}R`);
/** +0.19% — a signed percentage that is already ×100. */
export const pctSigned = (x) => (x === null || x === undefined ? '—' : `${signed(x, Math.abs(x) >= 10 ? 1 : 2)}%`);
export const pct = (x) => (x === null || x === undefined ? '—' : `${Math.round(x * 100)}%`);

export function ratio(x) {
  if (x === null || x === undefined) return '—';
  if (x === Infinity) return '∞';
  return x.toFixed(2);
}

/** CSS tone class for an amount. */
export const tone = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : 'flat');

/** Number of decimals implied by a tick size (0.25 → 2). */
export function tickDecimals(tick) {
  const s = String(tick);
  return s.includes('.') ? s.split('.')[1].length : 0;
}

export function price(x, tick = 0.25) {
  if (x === null || x === undefined || x === '') return '';
  return Number(x).toFixed(Math.max(2, tickDecimals(tick)));
}

// -------------------------------------------------------------------- dates

const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

export const monthName = (m) => MONTH[m];
export const monthShort = (m) => MON[m];

/** "YYYY-MM-DD" → local Date at midnight */
export function fromDayKey(key) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** "Tue, Oct 27" */
export function dayLabel(dateOrKey) {
  const d = typeof dateOrKey === 'string' && dateOrKey.length === 10 ? fromDayKey(dateOrKey) : new Date(dateOrKey);
  return `${DOW[d.getDay()]}, ${MON[d.getMonth()]} ${d.getDate()}`;
}

/** "Oct 27" */
export function shortDate(dateOrKey) {
  const d = typeof dateOrKey === 'string' && dateOrKey.length === 10 ? fromDayKey(dateOrKey) : new Date(dateOrKey);
  return `${MON[d.getMonth()]} ${d.getDate()}`;
}

/** "09:42" (24-hour, local) */
export function time(iso) {
  const d = new Date(iso);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** ISO → value for <input type="datetime-local"> */
export function toLocalInput(iso) {
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromLocalInput(value) {
  const d = new Date(value); // "YYYY-MM-DDTHH:MM" parses as local time
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function daysAgo(iso) {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}

/** Escape text for safe use inside innerHTML. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
