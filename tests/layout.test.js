import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gridOf, layoutSheet } from '../server/utils/layout.js';
import { barcodeSvg, renderSheetDocument, escapeHtml } from '../server/utils/render.js';

const LETTER = { sheetWidth: 8.5, sheetHeight: 11, sheetMargin: 0.5, labelWidth: 2.5, labelHeight: 1, labelGap: 0, labelTextSize: 9, cutGuides: true };

test('a 2.5 x 1 inch label on letter paper with half-inch margins is 3 across and 10 down', () => {
  const [error, grid] = gridOf(LETTER);
  assert.equal(error, null);
  assert.deepEqual(grid, { columns: 3, rows: 10, perPage: 30 });
});

test('a gap between labels takes room', () => {
  const [, grid] = gridOf({ ...LETTER, labelGap: 0.25 });
  assert.deepEqual(grid, { columns: 2, rows: 8, perPage: 16 });
});

test('smaller labels and a narrow margin fit more', () => {
  const [, grid] = gridOf({ ...LETTER, sheetMargin: 0.25, labelWidth: 2, labelHeight: 0.75 });
  assert.deepEqual(grid, { columns: 4, rows: 14, perPage: 56 });
});

test('a label bigger than the paper is explained, not crashed on', () => {
  const [error, grid] = gridOf({ ...LETTER, labelWidth: 9 });
  assert.equal(grid, null);
  assert.equal(error.code, 400);
  assert.match(error.msg, /bigger than/);
});

test('entries run on from one another so no paper is wasted between them', () => {
  const [error, layout] = layoutSheet([{ quantity: 3, code: 'A' }, { quantity: 1, code: 'B' }, { quantity: 2, code: 'C' }], LETTER);
  assert.equal(error, null);
  assert.equal(layout.total, 6);
  assert.equal(layout.pages.length, 1);
  assert.deepEqual(layout.pages[0].map(label => label.code), ['A', 'A', 'A', 'B', 'C', 'C']);
});

test('more labels than a page holds spill onto the next page', () => {
  const [, layout] = layoutSheet([{ quantity: 31, code: 'A' }], LETTER);
  assert.deepEqual(layout.pages.map(page => page.length), [30, 1]);
});

test('an empty sheet has no pages', () => {
  const [, layout] = layoutSheet([], LETTER);
  assert.equal(layout.total, 0);
  assert.deepEqual(layout.pages, []);
});

test('a real UPC and a made-up code both draw as SVG', () => {
  assert.match(barcodeSvg('036000291452'), /^<svg /);
  assert.match(barcodeSvg('INV-000123'), /^<svg /);
  assert.match(barcodeSvg('04252614'), /^<svg /);
  assert.match(barcodeSvg('96385074'), /^<svg /);
  assert.match(barcodeSvg('4006381333931'), /^<svg /);
});

test('the print page has one label per copy, the name only where asked, and is escaped', () => {
  const [, layout] = layoutSheet([
    { quantity: 2, code: 'INV-000123', name: 'Overture <Medium> Gray', showText: true },
    { quantity: 1, code: '036000291452', name: 'Hidden name', showText: false },
  ], LETTER);
  const page = renderSheetDocument({ title: 'My "sheet"', layout, config: LETTER });
  assert.equal(page.match(/class="label"/g).length, 3);
  assert.equal(page.match(/class="name"/g).length, 2);
  assert.ok(page.includes('Overture &lt;Medium&gt; Gray'));
  assert.ok(!page.includes('Hidden name'));
  assert.ok(page.includes('My &quot;sheet&quot;'));
  assert.ok(page.includes('@page { size: 8.5in 11in; margin: 0; }'));
  assert.ok(page.includes('grid-template-columns: repeat(3, 2.5in)'));
  assert.ok(page.includes('3 labels on 1 page'));
});

test('escapeHtml leaves nothing that could close an attribute or open a tag', () => {
  assert.equal(escapeHtml(`<a href="x" onclick='y'>&`), '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;');
});
