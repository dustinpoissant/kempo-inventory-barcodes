import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { getItem, getItems } from 'kempo-inventory/sdk';
import { kempoInventoryBarcode, kempoInventoryBarcodeCounter, kempoInventoryBarcodeSheetEntry } from '../db/schema.js';
import { cleanCode, lookupKey, kindOf, isGtin, looksMistyped, formatInternal, MAX_CODE } from './codes.js';
import { getConfig } from './config.js';

/*
  The codes that open an inventory item. An item can have any number; one is its primary, the one that prints
  by default. Every function resolves to [error, result] and never throws.
*/

const newId = () => crypto.randomBytes(8).toString('hex');

const isUniqueViolation = error => (error?.code || error?.cause?.code) === '23505';

const failed = msg => [{ code: 500, msg }, null];

/* A code as the API shows it: the comparison key is internal. */
export const shapeCode = ({ lookup, ...rest }) => rest;

const byPrimaryThenOldest = [desc(kempoInventoryBarcode.isPrimary), asc(kempoInventoryBarcode.created), asc(kempoInventoryBarcode.id)];

/*
  Reading
*/
export const getCodes = async itemId => {
  try {
    const rows = await db.select().from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.itemId, itemId)).orderBy(...byPrimaryThenOldest);
    return [null, rows.map(shapeCode)];
  } catch {
    return failed('Failed to retrieve barcodes');
  }
};

/* Codes of many items at once: { itemId: [code, ...] }. */
export const getCodesForItems = async itemIds => {
  if(!itemIds.length) return [null, {}];
  try {
    const rows = await db.select().from(kempoInventoryBarcode).where(inArray(kempoInventoryBarcode.itemId, itemIds)).orderBy(...byPrimaryThenOldest);
    const byItem = {};
    for(const row of rows) (byItem[row.itemId] ??= []).push(shapeCode(row));
    return [null, byItem];
  } catch {
    return failed('Failed to retrieve barcodes');
  }
};

/*
  An item that still has the code as its SKU, from before barcodes were kept apart: people have always been
  able to scan a barcode into the SKU box, and the SKU is unique, so it identifies the item just as well.
*/
const itemWithSku = async (code, exceptItemId = '') => {
  const key = lookupKey(code);
  const [error, data] = await getItems({ q: /^\d+$/.test(key) ? key : code, limit: 50 });
  if(error) return [error, null];
  return [null, data.items.find(candidate => candidate.id !== exceptItemId && lookupKey(candidate.sku) === key) ?? null];
};

/*
  The item a scanned code belongs to: a barcode first, then an item whose SKU is the code. Resolves to
  [null, { item, barcode, via }] where `barcode` is null when it was found by SKU.
*/
export const findByCode = async raw => {
  const code = cleanCode(raw);
  if(!code) return [{ code: 400, msg: 'A code is required' }, null];
  try {
    const [barcode] = await db.select().from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.lookup, lookupKey(code)));
    if(barcode){
      const [error, item] = await getItem(barcode.itemId);
      if(error) return [error, null];
      return [null, { item, barcode: shapeCode(barcode), via: 'barcode' }];
    }
  } catch {
    return failed('Failed to look up the barcode');
  }
  const [error, item] = await itemWithSku(code);
  if(error) return [error, null];
  if(!item) return [{ code: 404, msg: 'Nothing in the inventory has that barcode' }, null];
  return [null, { item, barcode: null, via: 'sku' }];
};

/*
  Adding
*/
const insertCode = async ({ itemId, code, kind, primary }) => {
  const row = { id: newId(), code, lookup: lookupKey(code), itemId, kind, isPrimary: primary, created: new Date() };
  await db.transaction(async tx => {
    if(primary) await tx.update(kempoInventoryBarcode).set({ isPrimary: false }).where(and(eq(kempoInventoryBarcode.itemId, itemId), eq(kempoInventoryBarcode.isPrimary, true)));
    await tx.insert(kempoInventoryBarcode).values(row);
  });
  return row;
};

/*
  Adds a code to an item. Adding one the item already has is not an error. A code that belongs to another
  item is refused with a 409 carrying `conflictItemId`, so the caller can offer to merge the two items.
  A product code whose last digit does not match is refused unless `force`, since it is nearly always a
  misread.
*/
export const addCode = async ({ itemId, code: raw, makePrimary = false, force = false } = {}) => {
  const code = cleanCode(raw);
  if(!code) return [{ code: 400, msg: 'A code is required' }, null];
  if(code.length > MAX_CODE) return [{ code: 400, msg: `A code can be at most ${MAX_CODE} characters` }, null];
  if(looksMistyped(code) && !force) return [{ code: 400, msg: `${code} looks like a product code but its last digit does not match. Check it was typed or scanned correctly.`, mistyped: true }, null];

  const [itemError] = await getItem(itemId);
  if(itemError) return [itemError, null];

  try {
    const [existing] = await db.select().from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.lookup, lookupKey(code)));
    if(existing){
      if(existing.itemId !== itemId) return [{ code: 409, msg: 'Another item already has this barcode', conflictItemId: existing.itemId }, null];
      return [null, { barcode: shapeCode(existing), existing: true }];
    }
    const [holderError, holder] = await itemWithSku(code, itemId);
    if(holderError) return [holderError, null];
    if(holder) return [{ code: 409, msg: `${holder.name} already uses this as its SKU`, conflictItemId: holder.id }, null];

    const owned = await db.select({ isPrimary: kempoInventoryBarcode.isPrimary }).from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.itemId, itemId));
    const row = await insertCode({ itemId, code, kind: kindOf(code), primary: makePrimary || !owned.some(own => own.isPrimary) });
    return [null, { barcode: shapeCode(row), existing: false }];
  } catch(error) {
    if(isUniqueViolation(error)) return [{ code: 409, msg: 'Another item already has this barcode' }, null];
    return failed('Failed to add the barcode');
  }
};

/*
  The made-up code for an item that has no barcode: PREFIX-000123, numbered from one counter so two people
  asking at once never get the same number. An item has at most one; asking again returns it.
*/
export const makeInternalCode = async itemId => {
  const [itemError] = await getItem(itemId);
  if(itemError) return [itemError, null];
  const { internalPrefix } = await getConfig();
  try {
    const [held] = await db.select().from(kempoInventoryBarcode).where(and(eq(kempoInventoryBarcode.itemId, itemId), eq(kempoInventoryBarcode.kind, 'internal')));
    if(held) return [null, { barcode: shapeCode(held), existing: true }];
    for(let attempt = 0; attempt < 5; attempt++){
      const [{ value }] = await db.insert(kempoInventoryBarcodeCounter).values({ name: 'internal', value: 1 })
        .onConflictDoUpdate({ target: kempoInventoryBarcodeCounter.name, set: { value: sql`${kempoInventoryBarcodeCounter.value} + 1` } }).returning();
      const code = formatInternal(internalPrefix, value);
      try {
        const owned = await db.select({ isPrimary: kempoInventoryBarcode.isPrimary }).from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.itemId, itemId));
        const row = await insertCode({ itemId, code, kind: 'internal', primary: !owned.some(own => own.isPrimary) });
        return [null, { barcode: shapeCode(row), existing: false }];
      } catch(error) {
        if(!isUniqueViolation(error)) throw error;
        const [again] = await db.select().from(kempoInventoryBarcode).where(and(eq(kempoInventoryBarcode.itemId, itemId), eq(kempoInventoryBarcode.kind, 'internal')));
        if(again) return [null, { barcode: shapeCode(again), existing: true }];
      }
    }
    return failed('Could not make a code for this item, please try again');
  } catch {
    return failed('Failed to make a code');
  }
};

/*
  The code an item prints by default, made if it has none: its SKU when that is a real product code, so an
  item that was scanned in before this extension prints its true barcode, and otherwise a made-up one.
*/
export const ensurePrimary = async itemId => {
  const [error, codes] = await getCodes(itemId);
  if(error) return [error, null];
  const primary = codes.find(code => code.isPrimary);
  if(primary) return [null, primary];
  if(codes.length){
    const [promoteError] = await setPrimary(codes[0].id);
    return promoteError ? [promoteError, null] : [null, { ...codes[0], isPrimary: true }];
  }
  const [itemError, item] = await getItem(itemId);
  if(itemError) return [itemError, null];
  if(isGtin(cleanCode(item.sku))){
    const [addError, added] = await addCode({ itemId, code: item.sku, makePrimary: true });
    if(!addError) return [null, added.barcode];
  }
  const [mintError, minted] = await makeInternalCode(itemId);
  return mintError ? [mintError, null] : [null, minted.barcode];
};

/*
  Changing
*/
export const setPrimary = async barcodeId => {
  try {
    const [row] = await db.select().from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.id, barcodeId));
    if(!row) return [{ code: 404, msg: 'Barcode not found' }, null];
    await db.transaction(async tx => {
      await tx.update(kempoInventoryBarcode).set({ isPrimary: false }).where(and(eq(kempoInventoryBarcode.itemId, row.itemId), eq(kempoInventoryBarcode.isPrimary, true)));
      await tx.update(kempoInventoryBarcode).set({ isPrimary: true }).where(eq(kempoInventoryBarcode.id, barcodeId));
    });
    return [null, { barcode: shapeCode({ ...row, isPrimary: true }) }];
  } catch {
    return failed('Failed to change the primary barcode');
  }
};

/*
  Removes a code. The primary one stays until another takes over, so an item that has codes always has a
  primary. Print sheet lines that used the removed code move to the primary.
*/
export const removeCode = async barcodeId => {
  try {
    const [row] = await db.select().from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.id, barcodeId));
    if(!row) return [{ code: 404, msg: 'Barcode not found' }, null];
    if(row.isPrimary) return [{ code: 409, msg: 'Make another code the primary one before removing this one' }, null];
    await db.transaction(async tx => {
      const [primary] = await tx.select().from(kempoInventoryBarcode).where(and(eq(kempoInventoryBarcode.itemId, row.itemId), eq(kempoInventoryBarcode.isPrimary, true)));
      const lines = await tx.select().from(kempoInventoryBarcodeSheetEntry).where(eq(kempoInventoryBarcodeSheetEntry.barcodeId, barcodeId));
      for(const line of lines){
        /* A sheet with a line for the primary already has the removed code's copies added to that line. */
        const [same] = primary ? await tx.select().from(kempoInventoryBarcodeSheetEntry).where(and(eq(kempoInventoryBarcodeSheetEntry.sheetId, line.sheetId), eq(kempoInventoryBarcodeSheetEntry.barcodeId, primary.id))) : [];
        if(same){
          await tx.update(kempoInventoryBarcodeSheetEntry).set({ quantity: sql`least(500, ${kempoInventoryBarcodeSheetEntry.quantity} + ${line.quantity})` }).where(eq(kempoInventoryBarcodeSheetEntry.id, same.id));
          await tx.delete(kempoInventoryBarcodeSheetEntry).where(eq(kempoInventoryBarcodeSheetEntry.id, line.id));
        } else if(primary){
          await tx.update(kempoInventoryBarcodeSheetEntry).set({ barcodeId: primary.id }).where(eq(kempoInventoryBarcodeSheetEntry.id, line.id));
        }
      }
      await tx.delete(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.id, barcodeId));
    });
    return [null, { success: true }];
  } catch {
    return failed('Failed to remove the barcode');
  }
};

/* Everything that belongs to an item that no longer exists. */
export const removeForItem = async itemId => {
  try {
    await db.transaction(async tx => {
      await tx.delete(kempoInventoryBarcodeSheetEntry).where(eq(kempoInventoryBarcodeSheetEntry.itemId, itemId));
      await tx.delete(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.itemId, itemId));
    });
    return [null, { success: true }];
  } catch {
    return failed('Failed to remove the item\'s barcodes');
  }
};

/*
  Items scanned in before this extension kept the barcode as their SKU. Gives every item whose SKU is a real
  product code a barcode of the same text, so it prints as the true UPC or EAN and a scan matches it with or
  without a leading zero. SKUs that are not product codes (part numbers) are left alone. Safe to run again.

  Resolves to [null, { checked, added, already, conflicts: [{ id, name, sku, otherId, otherName }] }], a
  conflict being an item whose code another item already has (`otherId`), which usually means a duplicate.
*/
export const adoptSkus = async () => {
  const summary = { checked: 0, added: 0, already: 0, conflicts: [] };
  const pageSize = 200;
  for(let offset = 0; ; offset += pageSize){
    const [error, data] = await getItems({ limit: pageSize, offset });
    if(error) return [error, null];
    for(const item of data.items){
      summary.checked++;
      const sku = cleanCode(item.sku);
      if(!isGtin(sku)) continue;
      const [addError, added] = await addCode({ itemId: item.id, code: sku });
      if(addError){
        const [, other] = addError.conflictItemId ? await getItem(addError.conflictItemId) : [null, null];
        summary.conflicts.push({ id: item.id, name: item.name, sku: item.sku, otherId: addError.conflictItemId ?? '', otherName: other?.name ?? '' });
      }
      else if(added.existing) summary.already++;
      else summary.added++;
    }
    if(offset + pageSize >= data.total) break;
  }
  return [null, summary];
};
