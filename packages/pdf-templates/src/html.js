// Tiny auto-escaping HTML templating for print layouts. Every interpolated value is escaped unless
// wrapped in raw(); arrays are joined. (ADR deviation: plain functions instead of React server
// rendering, so the worker needs no JSX build step. Same output: static HTML for Chromium.)

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export const escapeHtml = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

class Raw {
  constructor(s) {
    this.s = s;
  }
  toString() {
    return this.s;
  }
}

/** Mark trusted markup (other templates, data URLs) as safe. */
export const raw = (s) => new Raw(String(s ?? ''));

function render(v) {
  if (v === null || v === undefined || v === false) return '';
  if (v instanceof Raw) return v.s;
  if (Array.isArray(v)) return v.map(render).join('');
  return escapeHtml(v);
}

/** html`<p>${userText}</p>` → Raw */
export function html(strings, ...values) {
  let out = strings[0];
  values.forEach((v, i) => {
    out += render(v) + strings[i + 1];
  });
  return new Raw(out);
}
