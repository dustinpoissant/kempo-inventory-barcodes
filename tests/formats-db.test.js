import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { createItem } from 'kempo-inventory/sdk';
import install from '../install.js';
import { saveFormat, storedFormats, formatFor, categoriesWithFormats, previewFor } from '../server/utils/formats.js';
import { createSheet, addEntry, getSheet } from '../server/utils/sheets.js';

const unitTier = process.env.KEMPO_DB === 'pglite';
const url = process.env.DATABASE_URL ?? '';
const reachable = (unitTier || /_test$/.test(url.split('?')[0])) && await db.execute(sql`select 1`).then(() => true).catch(() => false);
const ok = ([error, value]) => {
  assert.equal(error, null, error?.msg);
  return value;
};
const refused = ([error, value], code) => {
  assert.ok(error, 'expected an error');
  assert.equal(value, null);
  if(code) assert.equal(error.code, code, error.msg);
  return error;
};
const ME = { userId: 'format-tester', manage: true };

after(() => unitTier ? db.$client.close() : db.$client.end());

describe('label formats in the database', { skip: reachable ? false : 'no throwaway database' }, () => {
  before(async () => {
    await install();
    await db.execute(sql.raw('delete from "kempoInventoryBarcodeFormat"'));
    await db.execute(sql.raw('delete from "kempoInventoryBarcodeSheetEntry"'));
    await db.execute(sql.raw('delete from "kempoInventoryBarcodeSheet"'));
    await db.execute(sql.raw('delete from "kempoInventoryBarcode"'));
    await db.execute(sql.raw('delete from "kempoInventoryItem"'));
  });

  test('a category format is saved, read back, and cleared by an empty one', async () => {
    ok(await saveFormat({ scope: 'category', key: 'paints', format: '{name} ({sku})' }));
    assert.equal(ok(await storedFormats()).category.paints, '{name} ({sku})');
    ok(await saveFormat({ scope: 'category', key: 'paints', format: '{attribute:brand|name}' }));
    assert.equal(ok(await storedFormats()).category.paints, '{attribute:brand|name}');
    ok(await saveFormat({ scope: 'category', key: 'paints', format: '   ' }));
    assert.equal(ok(await storedFormats()).category.paints, undefined);
  });

  test('a bad format is refused before anything is written', async () => {
    refused(await saveFormat({ scope: 'category', key: 'paints', format: '{nope}' }), 400);
    refused(await saveFormat({ scope: 'category', key: 'paints', format: '{name' }), 400);
    refused(await saveFormat({ scope: 'shelf', key: 'x', format: '{name}' }), 400);
    refused(await saveFormat({ scope: 'item', key: '', format: '{name}' }), 400);
    assert.deepEqual(ok(await storedFormats()).category, {});
  });

  test('an item format overrides its category, and clearing it returns to the category', async () => {
    const item = ok(await createItem({ sku: 'FMT-1', name: 'Gray', category: 'Paints' }));
    ok(await saveFormat({ scope: 'category', key: 'paints', format: '{name} / category' }));
    ok(await saveFormat({ scope: 'item', key: item.id, format: '{name} / item' }));
    let stored = ok(await storedFormats());
    assert.equal(formatFor({ ...item, category: 'Paints' }, stored, '{name}').source, 'item');
    ok(await saveFormat({ scope: 'item', key: item.id, format: '' }));
    stored = ok(await storedFormats());
    assert.equal(formatFor({ ...item, category: 'Paints' }, stored, '{name}').source, 'category');
  });

  test('the categories list shows each category, its count, and its own format', async () => {
    ok(await createItem({ sku: 'FMT-2', name: 'Gloss', category: 'Clear Coats' }));
    ok(await saveFormat({ scope: 'category', key: 'paints', format: '{name} !' }));
    const categories = ok(await categoriesWithFormats());
    const paints = categories.find(category => category.key === 'paints');
    assert.equal(paints.count, 1);
    assert.equal(paints.format, '{name} !');
    assert.equal(categories.find(category => category.key === 'clear coats').format, '');
  });

  test('a preview shows the text an unsaved format would print for an item', async () => {
    const item = ok(await createItem({ sku: 'FMT-3', name: 'Preview me', category: 'Paints' }));
    assert.equal(ok(await previewFor({ format: '{name} <- preview', itemId: item.id })).text, 'Preview me <- preview');
    refused(await previewFor({ format: '{nope}', itemId: item.id }), 400);
  });

  test('a sheet line prints the format of its item, not the site default', async () => {
    const item = ok(await createItem({ sku: 'FMT-4', name: 'Sheet item', category: 'Paints' }));
    ok(await saveFormat({ scope: 'item', key: item.id, format: 'ONLY {name}' }));
    const sheet = ok(await createSheet({ userId: ME.userId, name: 'Formats' })).sheet;
    ok(await addEntry(sheet.id, { ...ME, itemId: item.id, quantity: 1 }));
    const data = ok(await getSheet(sheet.id, ME));
    assert.equal(data.entries[0].labelText, 'ONLY Sheet item');
  });
});
