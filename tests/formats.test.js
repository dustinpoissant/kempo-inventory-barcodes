import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatFor, labelFor } from '../server/utils/formats.js';

const fields = [
  { key: 'brand', label: 'Brand', type: 'text', category: 'paints' },
  { key: 'finish', label: 'Finish', type: 'text', category: 'paints' },
];
const paint = { id: 'p1', name: 'Admiral Blue', sku: '1', category: 'Paints', fields: { brand: 'Apple Barrel', finish: 'Matte' } };
const SITE = '{name}';

test('an item\'s own format beats its category\'s, which beats the site default', () => {
  const stored = { item: { p1: '{attribute:brand} {name}' }, category: { paints: '{attribute:finish} {name}' } };
  assert.deepEqual(formatFor(paint, stored, SITE), { format: '{attribute:brand} {name}', source: 'item' });
  assert.deepEqual(formatFor(paint, { item: {}, category: stored.category }, SITE), { format: '{attribute:finish} {name}', source: 'category' });
  assert.deepEqual(formatFor(paint, { item: {}, category: {} }, SITE), { format: SITE, source: 'site' });
});

test('a category is matched however its name is spaced or cased', () => {
  const spaced = { ...paint, category: '  PAINTS ' };
  assert.equal(formatFor(spaced, { item: {}, category: { paints: '{name}!' } }, SITE).source, 'category');
});

test('an uncategorised item uses the site default, never a category row', () => {
  const none = { ...paint, category: '' };
  assert.equal(formatFor(none, { item: {}, category: { '': '{name}?' } }, SITE).source, 'site');
});

test('no site format set falls back to the name', () => {
  assert.equal(formatFor(paint, { item: {}, category: {} }, '').format, '{name}');
});

test('labelFor says what it printed and from which level', () => {
  const stored = { item: {}, category: { paints: '{attribute:brand|"?"} / {name}' } };
  assert.deepEqual(labelFor(paint, fields, stored, SITE), { text: 'Apple Barrel / Admiral Blue', format: '{attribute:brand|"?"} / {name}', source: 'category' });
  assert.equal(labelFor({ ...paint, fields: {} }, fields, stored, SITE).text, '? / Admiral Blue');
});
