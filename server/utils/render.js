import bwipjs from 'bwip-js';
import { symbologyFor } from './codes.js';

/*
  Draws barcodes and the printable page of labels. Nothing here touches the database or the request.
*/

export const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));

/*
  The code as an SVG that scales to whatever box it is put in. The digits or text under the bars are drawn
  as shapes, so no font is needed to print or to read it.
*/
export const barcodeSvg = code => bwipjs.toSVG({
  bcid: symbologyFor(code),
  text: code,
  includetext: true,
  textxalign: 'center',
  textsize: 9,
  textgaps: 1,
  height: 12,
  paddingwidth: 8,
  paddingheight: 2,
  backgroundcolor: 'FFFFFF',
});

/* The most lines of an item name a label shows; the space for them is always reserved so barcodes line up. */
const NAME_LINES = 2;

/*
  A complete, standalone page: it needs nothing from the site, so it prints the same from any browser.
  Its sizes are the site's settings, so they cannot be utility classes and are the one place this extension
  writes CSS.

    layout: what layoutSheet returned; labels: [{ code, name, showText }]
*/
export const renderSheetDocument = ({ title, layout, config }) => {
  const { sheetWidth, sheetHeight, sheetMargin, labelWidth, labelHeight, labelGap, labelTextSize, cutGuides } = config;
  const svgs = new Map();
  const drawn = code => {
    if(!svgs.has(code)) svgs.set(code, barcodeSvg(code));
    return svgs.get(code);
  };
  const pages = layout.pages.map(labels => `<section class="page">${labels.map(label => `<div class="label">${label.showText ? `<div class="name">${escapeHtml(label.name)}</div>` : ''}<div class="code">${drawn(label.code)}</div></div>`).join('')}</section>`).join('');
  const pageWord = layout.pages.length === 1 ? 'page' : 'pages';
  const labelWord = layout.total === 1 ? 'label' : 'labels';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
@page { size: ${sheetWidth}in ${sheetHeight}in; margin: 0; }
* { box-sizing: border-box; }
body { margin: 0; background: #d8d8d8; font-family: system-ui, sans-serif; color: #000; }
.toolbar { position: sticky; top: 0; z-index: 1; display: flex; flex-wrap: wrap; align-items: center; gap: 0.75rem; padding: 0.75rem 1rem; background: #fff; border-bottom: 1px solid #bbb; }
.toolbar p { margin: 0; }
.toolbar .hint { flex: 1; color: #555; font-size: 0.9rem; }
.toolbar button { font: inherit; padding: 0.5rem 1.25rem; cursor: pointer; }
.page { width: ${sheetWidth}in; height: ${sheetHeight}in; margin: 1rem auto; padding: ${sheetMargin}in; display: grid; grid-template-columns: repeat(${layout.columns}, ${labelWidth}in); grid-auto-rows: ${labelHeight}in; gap: ${labelGap}in; align-content: start; justify-content: start; background: #fff; box-shadow: 0 1px 6px rgba(0, 0, 0, 0.35); break-after: page; overflow: hidden; }
.label { display: flex; flex-direction: column; align-items: stretch; justify-content: center; padding: 0.05in 0.08in; overflow: hidden;${cutGuides ? ' border: 0.5pt dashed #999;' : ''} }
.name { flex: none; height: ${NAME_LINES * 1.15}em; font-size: ${labelTextSize}pt; line-height: 1.15; text-align: center; font-weight: 600; overflow: hidden; display: -webkit-box; -webkit-line-clamp: ${NAME_LINES}; -webkit-box-orient: vertical; }
.code { flex: 1; min-height: 0; }
.code svg { display: block; width: 100%; height: 100%; }
@media print {
  body { background: #fff; }
  .toolbar { display: none; }
  .page { margin: 0; box-shadow: none; }
  .page:last-child { break-after: auto; }
}
</style>
</head>
<body>
<div class="toolbar">
<button type="button" onclick="window.print()">Print</button>
<p><strong>${escapeHtml(title)}</strong>: ${layout.total} ${labelWord} on ${layout.pages.length} ${pageWord}</p>
<p class="hint">In the print dialog choose scale 100% (Actual size), not Fit to page, or the labels will not match their size.</p>
</div>
${pages}
</body>
</html>
`;
};
