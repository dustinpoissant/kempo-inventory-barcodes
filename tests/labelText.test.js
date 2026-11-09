import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slugOf, attributesOf, labelTextOf, DEFAULT_TEMPLATE } from '../server/utils/labelText.js';

const fields = [
  { key: 'brand', label: 'Brand', type: 'text', category: 'paints' },
  { key: 'finish', label: 'Finish', type: 'text', category: 'paints' },
  { key: 'clearBrand', label: 'Brand', type: 'text', category: 'clear coats' },
  { key: 'clearFinish', label: 'Finish', type: 'text', category: 'clear coats' },
  { key: 'manufacturerCode', label: 'Manufacturer Code', type: 'text', category: '' },
  { key: 'photos', label: 'Photos', type: 'media', category: '' },
  { key: 'color', label: 'Color', type: 'color', category: 'paints' },
];

const paint = { name: 'Admiral Blue', sku: '028995214844', category: 'Paints', fields: { brand: 'Apple Barrel', finish: 'Matte', color: '#000747', photos: ['files:x'], manufacturerCode: '21484E' } };

test('a label is slugged from its field label, whatever the field key', () => {
  assert.equal(slugOf('Manufacturer Code'), 'manufacturer-code');
  assert.equal(slugOf('  Café  Brand!! '), 'cafe-brand');
  assert.equal(slugOf('***'), '');
});

test('the default template makes "Apple Barrel - Matte - Admiral Blue"', () => {
  assert.equal(labelTextOf(DEFAULT_TEMPLATE, paint, fields), 'Apple Barrel - Matte - Admiral Blue');
});

test('an attribute the item lacks drops out with its dash, leaving no doubled separators', () => {
  const noFinish = { ...paint, fields: { brand: 'Apple Barrel' } };
  assert.equal(labelTextOf(DEFAULT_TEMPLATE, noFinish, fields), 'Apple Barrel - Admiral Blue');
  const noBrand = { ...paint, fields: {} };
  assert.equal(labelTextOf(DEFAULT_TEMPLATE, noBrand, fields), 'Admiral Blue');
  assert.equal(labelTextOf('{attribute:brand} - {attribute:finish} - {name}', { ...paint, name: 'X', fields: {} }, fields), 'X');
});

test('a brand is matched by label, so a clear coat with clearBrand still gets its brand', () => {
  const clear = { name: 'Gloss', category: 'Clear Coats', fields: { clearBrand: 'Createx', clearFinish: 'Gloss' } };
  assert.equal(labelTextOf(DEFAULT_TEMPLATE, clear, fields), 'Createx - Gloss - Gloss');
  assert.deepEqual(attributesOf(clear, fields), { brand: 'Createx', finish: 'Gloss' });
});

test('photos and colours are never printed, and a category field only applies to its category', () => {
  assert.deepEqual(attributesOf(paint, fields), { brand: 'Apple Barrel', finish: 'Matte', 'manufacturer-code': '21484E' });
  const hardware = { name: 'Chain', category: 'Parts', fields: { brand: 'Acme', finish: 'Matte' } };
  assert.equal(labelTextOf(DEFAULT_TEMPLATE, hardware, fields), 'Chain');
});

test('any slug can be used: a shorter label, the SKU, the category, and text around the slugs', () => {
  assert.equal(labelTextOf('{attribute:brand} {name}', paint, fields), 'Apple Barrel Admiral Blue');
  assert.equal(labelTextOf('{name} ({sku})', paint, fields), 'Admiral Blue (028995214844)');
  assert.equal(labelTextOf('{attribute:manufacturer-code} | {name} | {category}', paint, fields), '21484E | Admiral Blue | Paints');
});

test('an unknown slug is left out, and the template can be empty', () => {
  assert.equal(labelTextOf('{nope} - {name}', paint, fields), 'Admiral Blue');
  assert.equal(labelTextOf('', paint, fields), 'Apple Barrel - Matte - Admiral Blue');
});

test('a value that itself contains a dash is kept as it was typed', () => {
  const dashed = { ...paint, name: 'Mid-Gray' };
  assert.equal(labelTextOf(DEFAULT_TEMPLATE, dashed, fields), 'Apple Barrel - Matte - Mid-Gray');
});
