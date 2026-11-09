import { test, before, after, describe } from 'node:test';
import assert from 'node:assert/strict';
import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { createItem, getItem, adjustQuantity } from 'kempo-inventory/sdk';
import { kempoInventoryBarcode, kempoInventoryBarcodeSheetEntry } from '../server/db/schema.js';
import { addCode, getCodes, findByCode, ensurePrimary, makeInternalCode, setPrimary, removeCode, removeForItem, adoptSkus } from '../server/utils/barcodes.js';
import { mergeItems } from '../server/utils/merge.js';
import { createSheet, listSheets, getSheet, addEntry, updateEntry, removeEntry, renameSheet, deleteSheet, getPrintout, removeSheetsOf } from '../server/utils/sheets.js';
import install from '../install.js';

/*
  The data layer against a real database. The unit tier is an in-memory PGlite that is always a throwaway;
  otherwise the database must be one whose name ends in _test, since these suites empty its tables.
*/
const url = process.env.DATABASE_URL ?? '';
const unitTier = process.env.KEMPO_DB === 'pglite';
const reachable = (unitTier || /_test$/.test(url.split('?')[0])) && await db.execute(sql`select 1`).then(() => true).catch(() => false);

if(!reachable && process.env.KEMPO_TEST_TIER === 'integration'){
  throw new Error('The integration tier needs DATABASE_URL pointing at a throwaway Postgres named *_test with the schema applied.');
}

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

const purge = async () => {
  for(const name of ['kempoInventoryBarcodeSheetEntry', 'kempoInventoryBarcodeSheet', 'kempoInventoryBarcodeCounter', 'kempoInventoryBarcode', 'kempoInventoryMovement', 'kempoInventoryItem']){
    await db.execute(sql.raw(`delete from "${name}"`));
  }
};

const ME = { userId: 'user-me', manage: false };
const OTHER = { userId: 'user-other', manage: false };
const ADMIN = { userId: 'user-admin', manage: true };

after(() => unitTier ? db.$client.close() : db.$client.end());

describe('barcodes', { skip: reachable ? false : 'no throwaway database (set DATABASE_URL to one ending in _test)' }, () => {
  before(async () => {
    await install();
  });

  test('an item scanned in with a product code as its SKU prints that code as its primary', async () => {
    await purge();
    const item = ok(await createItem({ sku: '036000291452', name: 'Bone White PLA', quantity: 2 }));
    const primary = ok(await ensurePrimary(item.id));
    assert.equal(primary.code, '036000291452');
    assert.equal(primary.kind, 'upc');
    assert.equal(primary.isPrimary, true);
    assert.equal(ok(await ensurePrimary(item.id)).id, primary.id);
  });

  test('an item with a part number as its SKU gets a made-up code, numbered in order', async () => {
    await purge();
    const first = ok(await createItem({ sku: 'FIL-1', name: 'Desert Sand PLA' }));
    const second = ok(await createItem({ sku: 'FIL-2', name: 'Medium Gray PLA' }));
    assert.equal(ok(await ensurePrimary(first.id)).code, 'INV-000001');
    assert.equal(ok(await ensurePrimary(second.id)).code, 'INV-000002');
    const again = ok(await makeInternalCode(first.id));
    assert.equal(again.existing, true);
    assert.equal(again.barcode.code, 'INV-000001');
  });

  test('a real code is added next to the made-up one and can take over as primary', async () => {
    await purge();
    const item = ok(await createItem({ sku: 'FIL-1', name: 'Overture Medium Gray' }));
    const temp = ok(await ensurePrimary(item.id));
    const added = ok(await addCode({ itemId: item.id, code: '4006381333931' }));
    assert.equal(added.barcode.isPrimary, false);
    assert.equal(added.barcode.kind, 'upc');

    refused(await removeCode(temp.id), 409);
    ok(await setPrimary(added.barcode.id));
    const codes = ok(await getCodes(item.id));
    assert.deepEqual(codes.map(code => [code.code, code.isPrimary]), [['4006381333931', true], [temp.code, false]]);

    ok(await removeCode(temp.id));
    assert.equal(ok(await getCodes(item.id)).length, 1);
  });

  test('adding a code an item already has is not an error, and one that belongs to another item is a conflict', async () => {
    await purge();
    const a = ok(await createItem({ sku: 'A', name: 'A' }));
    const b = ok(await createItem({ sku: 'B', name: 'B' }));
    ok(await addCode({ itemId: a.id, code: '036000291452' }));
    assert.equal(ok(await addCode({ itemId: a.id, code: '036000291452' })).existing, true);
    const error = refused(await addCode({ itemId: b.id, code: '036000291452' }), 409);
    assert.equal(error.conflictItemId, a.id);
    const variant = refused(await addCode({ itemId: b.id, code: '0036000291452' }), 409);
    assert.equal(variant.conflictItemId, a.id);
  });

  test('a code that is another item\'s SKU is a conflict too', async () => {
    await purge();
    const a = ok(await createItem({ sku: '036000291452', name: 'A' }));
    const b = ok(await createItem({ sku: 'B', name: 'B' }));
    assert.equal(refused(await addCode({ itemId: b.id, code: '036000291452' }), 409).conflictItemId, a.id);
  });

  test('a mistyped product code is refused unless forced, and blank or enormous codes are refused', async () => {
    await purge();
    const item = ok(await createItem({ sku: 'A', name: 'A' }));
    assert.equal(refused(await addCode({ itemId: item.id, code: '036000291453' }), 400).mistyped, true);
    ok(await addCode({ itemId: item.id, code: '036000291453', force: true }));
    refused(await addCode({ itemId: item.id, code: '   ' }), 400);
    refused(await addCode({ itemId: item.id, code: 'x'.repeat(101) }), 400);
    refused(await addCode({ itemId: 'nope', code: 'abc' }), 404);
  });

  test('a scan finds the item by barcode, by a leading-zero variant, or by SKU', async () => {
    await purge();
    const item = ok(await createItem({ sku: 'FIL-1', name: 'Gray' }));
    ok(await addCode({ itemId: item.id, code: '036000291452' }));
    const legacy = ok(await createItem({ sku: '4006381333931', name: 'Legacy' }));

    assert.equal(ok(await findByCode('036000291452')).item.id, item.id);
    assert.equal(ok(await findByCode('0036000291452')).item.id, item.id);
    assert.equal(ok(await findByCode(' 036000291452 ')).via, 'barcode');
    const bySku = ok(await findByCode('4006381333931'));
    assert.equal(bySku.item.id, legacy.id);
    assert.equal(bySku.via, 'sku');
    assert.equal(ok(await findByCode('04006381333931')).item.id, legacy.id);
    refused(await findByCode('999999999999'), 404);
    refused(await findByCode(''), 400);
  });

  test('adopting SKUs gives product-code SKUs a barcode and leaves part numbers alone, and can be repeated', async () => {
    await purge();
    await createItem({ sku: '036000291452', name: 'Has a UPC' });
    await createItem({ sku: 'CAR-1', name: 'Part number' });
    const first = ok(await adoptSkus());
    assert.deepEqual([first.checked, first.added, first.already, first.conflicts.length], [2, 1, 0, 0]);
    const second = ok(await adoptSkus());
    assert.deepEqual([second.added, second.already], [0, 1]);
  });

  test('adopting SKUs reports an item whose code another item holds, and which one', async () => {
    await purge();
    const first = ok(await createItem({ sku: '036000291452', name: 'First' }));
    const second = ok(await createItem({ sku: '0036000291452', name: 'Second' }));
    const summary = ok(await adoptSkus());
    assert.equal(summary.added, 0);
    assert.deepEqual(summary.conflicts.map(item => [item.id, item.otherId, item.otherName]).sort(), [[first.id, second.id, 'Second'], [second.id, first.id, 'First']].sort());
  });

  test('a deleted account takes its sheets and their lines, and nobody else\'s', async () => {
    await purge();
    const item = ok(await createItem({ sku: 'A', name: 'A' }));
    const mine = ok(await createSheet({ userId: ME.userId, name: 'Mine' })).sheet;
    const theirs = ok(await createSheet({ userId: OTHER.userId, name: 'Theirs' })).sheet;
    ok(await addEntry(mine.id, { ...ME, itemId: item.id }));
    ok(await addEntry(theirs.id, { ...OTHER, itemId: item.id }));
    ok(await removeSheetsOf(ME.userId));
    assert.equal(ok(await listSheets(ME)).sheets.length, 0);
    assert.equal(ok(await getSheet(theirs.id, OTHER)).entries.length, 1);
    assert.equal((await db.select().from(kempoInventoryBarcodeSheetEntry)).length, 1);
    ok(await removeSheetsOf(ME.userId));
    refused(await removeSheetsOf(''), 400);
  });

  test('removing an item takes its barcodes and sheet lines with it', async () => {
    await purge();
    const item = ok(await createItem({ sku: 'A', name: 'A' }));
    const sheet = ok(await createSheet({ userId: ME.userId, name: 'S' })).sheet;
    ok(await addEntry(sheet.id, { ...ME, itemId: item.id }));
    ok(await removeForItem(item.id));
    assert.equal((await db.select().from(kempoInventoryBarcode)).length, 0);
    assert.equal((await db.select().from(kempoInventoryBarcodeSheetEntry)).length, 0);
  });

  describe('sheets', () => {
    let gray;
    let sand;
    let sheet;

    before(async () => {
      await purge();
      gray = ok(await createItem({ sku: 'FIL-1', name: 'Overture Medium Gray' }));
      sand = ok(await createItem({ sku: '036000291452', name: 'Desert Sand' }));
      sheet = ok(await createSheet({ userId: ME.userId, name: 'Filament' })).sheet;
    });

    test('adding an item makes its code and puts it on the sheet with the name on by default', async () => {
      ok(await addEntry(sheet.id, { ...ME, itemId: gray.id, quantity: 3 }));
      ok(await addEntry(sheet.id, { ...ME, itemId: sand.id, quantity: 5, showText: false }));
      const data = ok(await getSheet(sheet.id, ME));
      assert.deepEqual(data.entries.map(entry => [entry.itemName, entry.code, entry.quantity, entry.showText]), [
        ['Overture Medium Gray', 'INV-000001', 3, true],
        ['Desert Sand', '036000291452', 5, false],
      ]);
      assert.deepEqual(data.summary, { labels: 8, pages: 1, perPage: 30, columns: 3, rows: 10 });
    });

    test('adding the same item again adds to the line instead of repeating it', async () => {
      ok(await addEntry(sheet.id, { ...ME, itemId: gray.id, quantity: 2 }));
      const data = ok(await getSheet(sheet.id, ME));
      assert.equal(data.entries.length, 2);
      assert.equal(data.entries[0].quantity, 5);
    });

    test('a different code of the same item is its own line, and must belong to the item', async () => {
      const real = ok(await addCode({ itemId: gray.id, code: '4006381333931' })).barcode;
      ok(await addEntry(sheet.id, { ...ME, itemId: gray.id, barcodeId: real.id, quantity: 1 }));
      assert.equal(ok(await getSheet(sheet.id, ME)).entries.length, 3);
      refused(await addEntry(sheet.id, { ...ME, itemId: sand.id, barcodeId: real.id }), 400);
    });

    test('several adds at once make one line, not several', async () => {
      const fresh = ok(await createItem({ sku: 'RACE', name: 'Race' }));
      const racing = ok(await createSheet({ userId: ME.userId, name: 'Racing' })).sheet;
      await Promise.all(Array.from({ length: 6 }, () => addEntry(racing.id, { ...ME, itemId: fresh.id, quantity: 2 })));
      const data = ok(await getSheet(racing.id, ME));
      assert.deepEqual(data.entries.map(entry => [entry.itemId, entry.quantity]), [[fresh.id, 12]]);
      ok(await deleteSheet(racing.id, ME));
    });

    test('switching a line to a code the sheet already has joins the two lines, and removing a code does too', async () => {
      const item = ok(await createItem({ sku: 'JOIN', name: 'Join' }));
      const joining = ok(await createSheet({ userId: ME.userId, name: 'Joining' })).sheet;
      const primary = ok(await ensurePrimary(item.id));
      const second = ok(await addCode({ itemId: item.id, code: 'SECOND-CODE' })).barcode;
      const third = ok(await addCode({ itemId: item.id, code: 'OTHER-CODE' })).barcode;
      ok(await addEntry(joining.id, { ...ME, itemId: item.id, barcodeId: primary.id, quantity: 2 }));
      ok(await addEntry(joining.id, { ...ME, itemId: item.id, barcodeId: second.id, quantity: 3 }));
      ok(await addEntry(joining.id, { ...ME, itemId: item.id, barcodeId: third.id, quantity: 4, showText: false }));

      let data = ok(await getSheet(joining.id, ME));
      ok(await updateEntry(joining.id, data.entries[1].id, { ...ME, barcodeId: primary.id }));
      data = ok(await getSheet(joining.id, ME));
      assert.deepEqual(data.entries.map(entry => [entry.code, entry.quantity]), [[primary.code, 5], ['OTHER-CODE', 4]]);

      ok(await removeCode(third.id));
      data = ok(await getSheet(joining.id, ME));
      assert.deepEqual(data.entries.map(entry => [entry.code, entry.quantity]), [[primary.code, 9]]);
      ok(await deleteSheet(joining.id, ME));
    });

    test('quantity, the name and the code can be changed, and a line removed', async () => {
      let data = ok(await getSheet(sheet.id, ME));
      const line = data.entries[0];
      ok(await updateEntry(sheet.id, line.id, { ...ME, quantity: 9, showText: false }));
      data = ok(await getSheet(sheet.id, ME));
      assert.deepEqual([data.entries[0].quantity, data.entries[0].showText], [9, false]);
      ok(await updateEntry(sheet.id, line.id, { ...ME, quantity: 100000 }));
      assert.equal(ok(await getSheet(sheet.id, ME)).entries[0].quantity, 500);
      refused(await updateEntry(sheet.id, line.id, { ...ME }), 400);
      ok(await removeEntry(sheet.id, data.entries[2].id, ME));
      assert.equal(ok(await getSheet(sheet.id, ME)).entries.length, 2);
      refused(await removeEntry(sheet.id, 'nope', ME), 404);
    });

    test('someone else cannot see or change the sheet, and an administrator can', async () => {
      refused(await getSheet(sheet.id, OTHER), 404);
      refused(await addEntry(sheet.id, { ...OTHER, itemId: gray.id }), 404);
      refused(await renameSheet(sheet.id, { ...OTHER, name: 'Mine now' }), 404);
      refused(await deleteSheet(sheet.id, OTHER), 404);
      assert.equal(ok(await getSheet(sheet.id, ADMIN)).sheet.name, 'Filament');
      assert.equal(ok(await listSheets(OTHER)).sheets.length, 0);
      assert.equal(ok(await listSheets(ME)).sheets.length, 1);
    });

    test('an administrator listing everyone\'s sheets sees how many lines and labels each has', async () => {
      const all = ok(await listSheets({ ...ADMIN, all: true })).sheets;
      assert.equal(all.length, 1);
      assert.equal(all[0].lines, 2);
      assert.equal(all[0].labels, 505);
    });

    test('the printout drops lines whose item is gone and lays the rest out', async () => {
      const spare = ok(await createItem({ sku: 'SPARE', name: 'Spare' }));
      ok(await addEntry(sheet.id, { ...ME, itemId: spare.id, quantity: 4 }));
      await removeForItem(spare.id);
      ok(await addEntry(sheet.id, { ...ME, itemId: sand.id, quantity: 1 }));
      const printout = ok(await getPrintout(sheet.id, ME));
      assert.equal(printout.title, 'Filament');
      assert.equal(printout.layout.total, 506);
      assert.equal(printout.layout.pages.length, Math.ceil(printout.layout.total / 30));
    });

    test('deleting a sheet removes its lines', async () => {
      ok(await deleteSheet(sheet.id, ME));
      assert.equal((await db.select().from(kempoInventoryBarcodeSheetEntry)).length, 0);
      refused(await getSheet(sheet.id, ME), 404);
    });
  });

  describe('merging', () => {
    test('the duplicate\'s codes, SKU, sheet lines and quantity move to the item that stays, and the duplicate is deleted', async () => {
      await purge();
      const temp = ok(await createItem({ sku: 'FIL-TEMP', name: 'Gray (made up)', quantity: 2 }));
      const real = ok(await createItem({ sku: 'FIL-REAL', name: 'Overture Medium Gray', quantity: 3 }));
      const tempCode = ok(await ensurePrimary(temp.id));
      const realCode = ok(await addCode({ itemId: real.id, code: '4006381333931' })).barcode;
      const sheet = ok(await createSheet({ userId: ME.userId, name: 'S' })).sheet;
      ok(await addEntry(sheet.id, { ...ME, itemId: temp.id, quantity: 4 }));

      const result = ok(await mergeItems({ fromId: temp.id, intoId: real.id, userId: ME.userId }));
      assert.equal(result.removed, true);
      assert.equal(result.warning, '');

      const [error] = await getItem(temp.id);
      assert.equal(error.code, 404);
      assert.equal(ok(await getItem(real.id)).quantity, 5);

      const codes = ok(await getCodes(real.id));
      assert.deepEqual(codes.map(code => code.code).sort(), ['4006381333931', 'FIL-TEMP', tempCode.code].sort());
      assert.deepEqual(codes.filter(code => code.isPrimary).map(code => code.id), [realCode.id]);
      assert.equal(ok(await findByCode(tempCode.code)).item.id, real.id);
      assert.equal(ok(await findByCode('FIL-TEMP')).item.id, real.id);

      const data = ok(await getSheet(sheet.id, ME));
      assert.deepEqual(data.entries.map(entry => [entry.itemId, entry.code, entry.quantity, entry.missing]), [[real.id, tempCode.code, 4, false]]);
    });

    test('when only the duplicate has codes, its primary becomes the primary', async () => {
      await purge();
      const dup = ok(await createItem({ sku: 'DUP', name: 'Dup' }));
      const keep = ok(await createItem({ sku: 'KEEP', name: 'Keep' }));
      const code = ok(await ensurePrimary(dup.id));
      ok(await mergeItems({ fromId: dup.id, intoId: keep.id }));
      const codes = ok(await getCodes(keep.id));
      assert.equal(codes.filter(own => own.isPrimary).length, 1);
      assert.equal(codes.find(own => own.isPrimary).code, code.code);
    });

    test('two made-up codes can both stay: the moved one stops being "internal"', async () => {
      await purge();
      const a = ok(await createItem({ sku: 'A', name: 'A' }));
      const b = ok(await createItem({ sku: 'B', name: 'B' }));
      ok(await ensurePrimary(a.id));
      ok(await ensurePrimary(b.id));
      ok(await mergeItems({ fromId: b.id, intoId: a.id }));
      const codes = ok(await getCodes(a.id));
      assert.equal(codes.length, 3);
      assert.equal(codes.filter(code => code.kind === 'internal').length, 1);
    });

    test('merging an item with itself, or with a missing one, is refused', async () => {
      await purge();
      const a = ok(await createItem({ sku: 'A', name: 'A' }));
      refused(await mergeItems({ fromId: a.id, intoId: a.id }), 400);
      refused(await mergeItems({ fromId: a.id, intoId: 'nope' }), 404);
      refused(await mergeItems({ fromId: 'nope', intoId: a.id }), 404);
    });

    test('the quantity moved is recorded as a movement on both items', async () => {
      await purge();
      const dup = ok(await createItem({ sku: 'DUP', name: 'Dup', quantity: 4 }));
      const keep = ok(await createItem({ sku: 'KEEP', name: 'Keep', quantity: 1 }));
      ok(await adjustQuantity(keep.id, { delta: 1 }));
      ok(await mergeItems({ fromId: dup.id, intoId: keep.id }));
      assert.equal(ok(await getItem(keep.id)).quantity, 6);
    });
  });
});
