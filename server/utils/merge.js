import crypto from 'node:crypto';
import { eq } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { getItem, adjustQuantity, deleteItem } from 'kempo-inventory/sdk';
import { kempoInventoryBarcode, kempoInventoryBarcodeSheetEntry } from '../db/schema.js';
import { cleanCode, lookupKey, kindOf } from './codes.js';

/*
  Two inventory items that turn out to be one thing, such as the item made up for a box with no barcode and
  the item that came in with the real one. Everything of the duplicate moves to the item that stays:

    - its barcodes (the primary of the item that stays remains primary), and its SKU as one more barcode,
      so a bin labelled with either still opens the right item
    - the lines of every print sheet that used it
    - its quantity, as a recorded movement on both items
    - and then the duplicate item is deleted.

  The first two happen together or not at all. The quantity and the deletion are the inventory's own work
  and can be refused (an item that products are made from cannot be deleted), so they come after, and a
  refusal is reported as a warning on a merge that otherwise went through: the duplicate is left empty and
  without codes, and can be deleted by hand.
*/

const newId = () => crypto.randomBytes(8).toString('hex');

export const mergeItems = async ({ fromId, intoId, userId = '' } = {}) => {
  if(!fromId || !intoId || fromId === intoId) return [{ code: 400, msg: 'Choose two different items to merge' }, null];
  const [fromError, from] = await getItem(fromId);
  if(fromError) return [fromError, null];
  const [intoError, into] = await getItem(intoId);
  if(intoError) return [intoError, null];

  try {
    const moved = await db.transaction(async tx => {
      const moving = await tx.select().from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.itemId, from.id));
      const staying = await tx.select().from(kempoInventoryBarcode).where(eq(kempoInventoryBarcode.itemId, into.id));
      const stayingInternal = staying.some(code => code.kind === 'internal');
      for(const code of moving){
        await tx.update(kempoInventoryBarcode).set({
          itemId: into.id,
          isPrimary: false,
          kind: code.kind === 'internal' && stayingInternal ? 'other' : code.kind,
        }).where(eq(kempoInventoryBarcode.id, code.id));
      }

      const known = new Set([...moving, ...staying].map(code => code.lookup));
      const sku = cleanCode(from.sku);
      const skuRow = sku && !known.has(lookupKey(sku))
        ? { id: newId(), code: sku, lookup: lookupKey(sku), itemId: into.id, kind: kindOf(sku), isPrimary: false, created: new Date() }
        : null;
      if(skuRow) await tx.insert(kempoInventoryBarcode).values(skuRow);

      if(!staying.some(code => code.isPrimary)){
        const promote = moving.find(code => code.isPrimary) ?? staying[0] ?? moving[0] ?? skuRow;
        if(promote) await tx.update(kempoInventoryBarcode).set({ isPrimary: true }).where(eq(kempoInventoryBarcode.id, promote.id));
      }

      await tx.update(kempoInventoryBarcodeSheetEntry).set({ itemId: into.id }).where(eq(kempoInventoryBarcodeSheetEntry.itemId, from.id));
      return moving.length + (skuRow ? 1 : 0);
    });

    const note = `Merged from ${from.name} (${from.sku})`;
    let warning = '';
    if(from.quantity > 0){
      const [takeError] = await adjustQuantity(from.id, { delta: -from.quantity, reason: 'merge', note: `Merged into ${into.name} (${into.sku})`, userId });
      if(takeError) warning = `The codes were merged but the quantity (${from.quantity}) could not be moved: ${takeError.msg}. Add it to ${into.name} by hand.`;
      else {
        const [giveError] = await adjustQuantity(into.id, { delta: from.quantity, reason: 'merge', note, userId });
        if(giveError){
          await adjustQuantity(from.id, { delta: from.quantity, reason: 'merge', note: 'Merge undone', userId });
          warning = `The codes were merged but the quantity (${from.quantity}) could not be moved: ${giveError.msg}. It was left on ${from.name}.`;
        }
      }
    }

    let removed = false;
    if(!warning){
      const [deleteError] = await deleteItem(from.id, { userId });
      if(deleteError) warning = `The codes and quantity were merged but ${from.name} could not be deleted: ${deleteError.msg}. Delete it by hand.`;
      else removed = true;
    }
    return [null, { into: into.id, from: from.id, codesMoved: moved, removed, warning }];
  } catch {
    return [{ code: 500, msg: 'Failed to merge the items' }, null];
  }
};
