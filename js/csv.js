// csv.js — minimal RFC 4180 CSV reading and writing.

export function toCsv(rows) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n');
}

/** "," normally; ";" for files saved by Excel in comma-decimal regions. */
export function detectDelimiter(text) {
  const header = text.split(/\r?\n/, 1)[0] || '';
  return (header.match(/;/g) || []).length > (header.match(/,/g) || []).length ? ';' : ',';
}

/** Parse CSV text into an array of rows (arrays of strings). */
export function parseCsv(text, delimiter = detectDelimiter(text)) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  const s = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((v) => v.trim() !== ''));
}

/**
 * Read a date + time typed in a spreadsheet, as local time. Accepts
 *   2026-10-21 09:42   2026-10-21T09:42:00   10/21/2026 9:42 AM   21/10/2026 14:05
 * and full ISO timestamps with Z or an offset. Slash dates are month/day
 * unless the first number is over 12. Returns a Date, or null.
 */
export function parseDateTime(input) {
  const s = String(input || '').trim().replace(/\s+/g, ' ');
  if (!s) return null;
  if (/[zZ]$|[+-]\d{2}:?\d{2}$/.test(s) && s.includes('T')) {
    const d = new Date(s);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  let y, mo, d, rest;
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](.*))?$/);
  if (m) { [, y, mo, d, rest] = m; }
  else if ((m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?:,? (.*))?$/))) {
    let a = Number(m[1]), b = Number(m[2]);
    if (a > 12 && b <= 12) [a, b] = [b, a];
    mo = a; d = b; y = m[3].length === 2 ? 2000 + Number(m[3]) : m[3]; rest = m[4];
  } else return null;
  let hh = 0, mm = 0, ss = 0;
  if (rest) {
    const t = rest.match(/^(\d{1,2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(?: ?([AaPp])\.?[Mm]\.?)?$/);
    if (!t) return null;
    hh = Number(t[1]); mm = Number(t[2]); ss = Number(t[3] || 0);
    if (t[4]) {
      if (hh < 1 || hh > 12) return null;
      hh = (hh % 12) + (/p/i.test(t[4]) ? 12 : 0);
    }
  }
  const date = new Date(Number(y), Number(mo) - 1, Number(d), hh, mm, ss);
  // Reject roll-overs like Feb 30 or 25:00.
  if (date.getMonth() !== Number(mo) - 1 || date.getDate() !== Number(d) || hh > 23 || mm > 59) return null;
  return date;
}
