// Common print layout (TASKS P0-15): letterhead, document title/number, run time,
// "system generated" footer, optional CANCELLED watermark (BR-DO-03). A4 portrait.
import { BRANCHES, displayDateTime } from '@dcl/shared';
import { html, raw } from './html.js';

export const BASE_CSS = `
  @page { size: A4; margin: 14mm 12mm 18mm 12mm; }
  * { box-sizing: border-box; }
  body { font-family: 'Segoe UI', Arial, sans-serif; font-size: 10.5pt; color: #0f1f33; margin: 0; }
  .lh { display: flex; align-items: center; gap: 12px; border-bottom: 2.5px solid #0c2744; padding-bottom: 8px; }
  .lh .mark { font-weight: 800; font-size: 26pt; color: #0c2744; letter-spacing: 1px; position: relative; padding-top: 6px; }
  .lh .mark::before { content: ''; position: absolute; left: 2px; right: -4px; top: 0; height: 6px; border-top: 3px solid #f26b1d; border-radius: 50% 50% 0 0; }
  .lh .co { flex: 1; }
  .lh .co b { font-size: 14pt; display: block; }
  .lh .co span { color: #586a80; font-size: 9pt; }
  .lh .doc { text-align: right; }
  .lh .doc .t { font-size: 14pt; font-weight: 700; color: #0c2744; }
  .lh .doc .n { font-size: 11pt; font-weight: 600; }
  h2 { font-size: 11pt; color: #0c2744; margin: 14px 0 6px; }
  table { width: 100%; border-collapse: collapse; margin-top: 6px; }
  th, td { border: 1px solid #cfd8e3; padding: 5px 6px; text-align: left; vertical-align: top; }
  th { background: #eaf0f6; font-weight: 600; }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .muted { color: #586a80; }
  .codes { display: flex; gap: 16px; align-items: flex-end; justify-content: flex-end; }
  .codes svg { display: block; }
  .watermark { position: fixed; inset: 0; display: flex; align-items: center; justify-content: center; pointer-events: none; }
  .watermark span { font-size: 96pt; font-weight: 800; color: rgba(200, 55, 42, 0.16); transform: rotate(-30deg); letter-spacing: 8px; }
`;

/**
 * Full HTML document.
 * @param {{ title: string, docNo?: string, brnch: number, runAt: Date, body: any, watermark?: string|null, extraCss?: string }} p
 */
export function page({ title, docNo, brnch, runAt, body, watermark = null, extraCss = '' }) {
  const branch = BRANCHES.find((b) => b.brnch === brnch);
  return html`<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8" />
        <title>${title}${docNo ? ` ${docNo}` : ''}</title>
        <style>
          ${raw(BASE_CSS)}${raw(extraCss)}
        </style>
      </head>
      <body>
        ${watermark ? html`<div class="watermark"><span>${watermark}</span></div>` : ''}
        <header class="lh">
          <div class="mark">DCL</div>
          <div class="co">
            <b>Dewan Cement Limited</b><span>${branch?.name ?? ''} · Sales &amp; Dispatch</span>
          </div>
          <div class="doc">
            <div class="t">${title}</div>
            ${docNo ? html`<div class="n">No. ${docNo}</div>` : ''}
            <div class="muted">Printed ${displayDateTime(runAt)}</div>
          </div>
        </header>
        <main>${body}</main>
      </body>
    </html>`.toString();
}

/** Footer for Chromium's footerTemplate (page numbers; "system generated" wording). */
export function footerTemplate(runAt) {
  return `<div style="font-family: Arial, sans-serif; font-size:7.5pt; color:#586a80; width:100%; padding:0 12mm; display:flex; justify-content:space-between;">
    <span>System generated document — no signature required. Printed ${displayDateTime(runAt)}.</span>
    <span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span>
  </div>`;
}
