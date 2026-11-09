import crypto from 'node:crypto';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { getUserById } from 'kempo/server/sdk.js';
import { getItem, getItems } from 'kempo-inventory/sdk';
import { kempoInventoryBarcode, kempoInventoryBarcodeSheet, kempoInventoryBarcodeSheetEntry } from '../db/schema.js';
import { getCodesForItems, ensurePrimary } from './barcodes.js';
import { getConfig } from './config.js';
import { layoutSheet, gridOf } from './layout.js';
import { labelFor, formatContext } from './formats.js';

/*
  Print sheets. A sheet belongs to the person who made it: everyone else gets a 404 for it, unless they hold
  the manage permission (`manage`), which is how an administrator tidies up. Every function resolves to
  [error, result] and never throws, and takes plain data: who is asking is `userId` and `manage`.
*/

export const MAX_QUANTITY = 500;

const newId = () => crypto.randomBytes(8).toString('hex');

const failed = msg => [{ code: 500, msg }, null];

const notFound = () => [{ code: 404, msg: 'Sheet not found' }, null];

const cleanName = raw => String(raw ?? '').trim().replace(/\s+/g, ' ').slice(0, 100);

const wholeNumber = (raw, fallback) => {
  const number = Number(raw);
  return Number.isInteger(number) ? number : fallback;
};

const touch = (tx, sheetId) => tx.update(kempoInventoryBarcodeSheet).set({ updated: new Date() }).where(eq(kempoInventoryBarcodeSheet.id, sheetId));

const loadSheet = async (id, { userId, manage }) => {
  const [sheet] = await db.select().from(kempoInventoryBarcodeSheet).where(eq(kempoInventoryBarcodeSheet.id, String(id ?? '')));
  return sheet && (manage || sheet.userId === userId) ? sheet : null;
};

/*
  Sheets
*/
export const createSheet = async ({ userId, name }) => {
  const now = new Date();
  const label = cleanName(name) || `Sheet ${now.toISOString().slice(0, 10)}`;
  try {
    const [sheet] = await db.insert(kempoInventoryBarcodeSheet).values({ id: newId(), userId, name: label, created: now, updated: now }).returning();
    return [null, { sheet }];
  } catch {
    return failed('Failed to create the sheet');
  }
};

/*
  The caller's sheets, newest first, each with how many lines and labels it holds. `all` lists everyone's and
  names their owners, for administrators.
*/
export const listSheets = async ({ userId, manage = false, all = false }) => {
  try {
    const entries = kempoInventoryBarcodeSheetEntry;
    const rows = await db.select({
      id: kempoInventoryBarcodeSheet.id,
      userId: kempoInventoryBarcodeSheet.userId,
      name: kempoInventoryBarcodeSheet.name,
      created: kempoInventoryBarcodeSheet.created,
      updated: kempoInventoryBarcodeSheet.updated,
      lines: sql`count(${entries.id})::int`,
      labels: sql`coalesce(sum(${entries.quantity}), 0)::int`,
    }).from(kempoInventoryBarcodeSheet)
      .leftJoin(entries, eq(entries.sheetId, kempoInventoryBarcodeSheet.id))
      .where(manage && all ? undefined : eq(kempoInventoryBarcodeSheet.userId, userId))
      .groupBy(kempoInventoryBarcodeSheet.id)
      .orderBy(desc(kempoInventoryBarcodeSheet.updated));
    if(!(manage && all)) return [null, { sheets: rows }];
    const owners = {};
    for(const id of new Set(rows.map(row => row.userId))){
      const [, user] = await getUserById(id);
      owners[id] = user?.name || user?.email || 'Deleted account';
    }
    return [null, { sheets: rows.map(row => ({ ...row, owner: owners[row.userId] })) }];
  } catch {
    return failed('Failed to retrieve sheets');
  }
};

/* Everything a person made: their sheets and the lines on them, for when their account is deleted. */
export const removeSheetsOf = async userId => {
  if(!userId) return [{ code: 400, msg: 'A user is required' }, null];
  try {
    await db.transaction(async tx => {
      const owned = (await tx.select({ id: kempoInventoryBarcodeSheet.id }).from(kempoInventoryBarcodeSheet).where(eq(kempoInventoryBarcodeSheet.userId, userId))).map(sheet => sheet.id);
      if(!owned.length) return;
      await tx.delete(kempoInventoryBarcodeSheetEntry).where(inArray(kempoInventoryBarcodeSheetEntry.sheetId, owned));
      await tx.delete(kempoInventoryBarcodeSheet).where(inArray(kempoInventoryBarcodeSheet.id, owned));
    });
    return [null, { success: true }];
  } catch {
    return failed('Failed to remove the person\'s sheets');
  }
};

export const renameSheet = async (id, { userId, manage, name }) => {
  const label = cleanName(name);
  if(!label) return [{ code: 400, msg: 'A sheet needs a name' }, null];
  try {
    const sheet = await loadSheet(id, { userId, manage });
    if(!sheet) return notFound();
    await db.update(kempoInventoryBarcodeSheet).set({ name: label, updated: new Date() }).where(eq(kempoInventoryBarcodeSheet.id, sheet.id));
    return [null, { success: true }];
  } catch {
    return failed('Failed to rename the sheet');
  }
};

export const deleteSheet = async (id, { userId, manage }) => {
  try {
    const sheet = await loadSheet(id, { userId, manage });
    if(!sheet) return notFound();
    await db.transaction(async tx => {
      await tx.delete(kempoInventoryBarcodeSheetEntry).where(eq(kempoInventoryBarcodeSheetEntry.sheetId, sheet.id));
      await tx.delete(kempoInventoryBarcodeSheet).where(eq(kempoInventoryBarcodeSheet.id, sheet.id));
    });
    return [null, { success: true }];
  } catch {
    return failed('Failed to delete the sheet');
  }
};

/*
  One sheet with its lines. Each line carries the item it is for, the code it prints, and every code that item
  has (so the page can offer a different one). `missing` marks a line whose item or code has been deleted:
  it stays so the person sees it, and is left out of the print.
*/
export const getSheet = async (id, { userId, manage }) => {
  try {
    const sheet = await loadSheet(id, { userId, manage });
    if(!sheet) return notFound();
    const rows = await db.select().from(kempoInventoryBarcodeSheetEntry).where(eq(kempoInventoryBarcodeSheetEntry.sheetId, sheet.id))
      .orderBy(asc(kempoInventoryBarcodeSheetEntry.position), asc(kempoInventoryBarcodeSheetEntry.created), asc(kempoInventoryBarcodeSheetEntry.id));
    const itemIds = [...new Set(rows.map(row => row.itemId))];
    const [itemsError, found] = itemIds.length ? await getItems({ ids: itemIds, limit: itemIds.length }) : [null, { items: [] }];
    if(itemsError) return [itemsError, null];
    const items = new Map(found.items.map(item => [item.id, item]));
    const [codesError, codes] = await getCodesForItems(itemIds);
    if(codesError) return [codesError, null];
    const config = await getConfig();
    const [contextError, context] = await formatContext();
    if(contextError) return [contextError, null];
    const entries = rows.map(row => {
      const item = items.get(row.itemId);
      const itemCodes = codes[row.itemId] ?? [];
      const code = itemCodes.find(candidate => candidate.id === row.barcodeId);
      return {
        id: row.id,
        itemId: row.itemId,
        itemName: item?.name ?? 'Deleted item',
        labelText: item ? labelFor(item, context.fields, context.stored, context.siteFormat).text : '',
        sku: item?.sku ?? '',
        barcodeId: row.barcodeId,
        code: code?.code ?? '',
        codes: itemCodes,
        quantity: row.quantity,
        showText: row.showText,
        missing: !item || !code,
      };
    });
    const [gridError, grid] = gridOf(config);
    const printable = entries.filter(entry => !entry.missing);
    const [, layout] = gridError ? [null, null] : layoutSheet(printable, config);
    return [null, {
      sheet: { id: sheet.id, userId: sheet.userId, name: sheet.name, created: sheet.created, updated: sheet.updated },
      entries,
      summary: gridError
        ? { error: gridError.msg }
        : { labels: layout.total, pages: layout.pages.length, perPage: grid.perPage, columns: grid.columns, rows: grid.rows },
    }];
  } catch {
    return failed('Failed to retrieve the sheet');
  }
};

/*
  Lines
*/
const clampQuantity = raw => Math.min(MAX_QUANTITY, Math.max(1, wholeNumber(raw, 1)));

/*
  Adds an item to a sheet. With no `barcodeId` it is the item's primary code, made first if the item has none.
  Adding what the sheet already has for that code adds to its quantity instead of repeating the line.
*/
export const addEntry = async (sheetId, { userId, manage, itemId, barcodeId, quantity = 1, showText }) => {
  try {
    const sheet = await loadSheet(sheetId, { userId, manage });
    if(!sheet) return notFound();
    const [itemError] = await getItem(itemId);
    if(itemError) return [itemError, null];

    let code;
    if(barcodeId){
      [code] = await db.select().from(kempoInventoryBarcode).where(and(eq(kempoInventoryBarcode.id, String(barcodeId)), eq(kempoInventoryBarcode.itemId, itemId)));
      if(!code) return [{ code: 400, msg: 'That barcode does not belong to this item' }, null];
    } else {
      const [primaryError, primary] = await ensurePrimary(itemId);
      if(primaryError) return [primaryError, null];
      code = primary;
    }

    const config = await getConfig();
    const copies = clampQuantity(quantity);
    const result = await db.transaction(async tx => {
      const [{ next }] = await tx.select({ next: sql`coalesce(max(${kempoInventoryBarcodeSheetEntry.position}), 0) + 1` }).from(kempoInventoryBarcodeSheetEntry).where(eq(kempoInventoryBarcodeSheetEntry.sheetId, sheet.id));
      /* One line per code: what is already there has its quantity added to, atomically, so two adds at once cannot make two lines. */
      const [line] = await tx.insert(kempoInventoryBarcodeSheetEntry).values({
        id: newId(), sheetId: sheet.id, itemId, barcodeId: code.id, quantity: copies,
        showText: typeof showText === 'boolean' ? showText : config.labelText, position: Number(next), created: new Date(),
      }).onConflictDoUpdate({
        target: [kempoInventoryBarcodeSheetEntry.sheetId, kempoInventoryBarcodeSheetEntry.barcodeId],
        set: { quantity: sql`least(${MAX_QUANTITY}, ${kempoInventoryBarcodeSheetEntry.quantity} + ${copies})` },
      }).returning({ id: kempoInventoryBarcodeSheetEntry.id });
      await touch(tx, sheet.id);
      return line.id;
    });
    return [null, { id: result }];
  } catch {
    return failed('Failed to add to the sheet');
  }
};

export const updateEntry = async (sheetId, entryId, { userId, manage, quantity, showText, barcodeId }) => {
  try {
    const sheet = await loadSheet(sheetId, { userId, manage });
    if(!sheet) return notFound();
    const [line] = await db.select().from(kempoInventoryBarcodeSheetEntry).where(and(eq(kempoInventoryBarcodeSheetEntry.id, String(entryId)), eq(kempoInventoryBarcodeSheetEntry.sheetId, sheet.id)));
    if(!line) return [{ code: 404, msg: 'Line not found' }, null];

    const changes = {};
    if(quantity !== undefined) changes.quantity = clampQuantity(quantity);
    if(typeof showText === 'boolean') changes.showText = showText;
    let code = null;
    if(barcodeId !== undefined){
      [code] = await db.select().from(kempoInventoryBarcode).where(and(eq(kempoInventoryBarcode.id, String(barcodeId)), eq(kempoInventoryBarcode.itemId, line.itemId)));
      if(!code) return [{ code: 400, msg: 'That barcode does not belong to this item' }, null];
    }
    if(!Object.keys(changes).length && !code) return [{ code: 400, msg: 'Nothing to change' }, null];

    await db.transaction(async tx => {
      /* Switching to a code the sheet already has a line for joins that line, which then holds both quantities. */
      const [same] = code && code.id !== line.barcodeId
        ? await tx.select().from(kempoInventoryBarcodeSheetEntry).where(and(eq(kempoInventoryBarcodeSheetEntry.sheetId, sheet.id), eq(kempoInventoryBarcodeSheetEntry.barcodeId, code.id)))
        : [];
      if(same){
        await tx.update(kempoInventoryBarcodeSheetEntry).set({ ...changes, quantity: clampQuantity(same.quantity + (changes.quantity ?? line.quantity)) }).where(eq(kempoInventoryBarcodeSheetEntry.id, same.id));
        await tx.delete(kempoInventoryBarcodeSheetEntry).where(eq(kempoInventoryBarcodeSheetEntry.id, line.id));
      } else {
        await tx.update(kempoInventoryBarcodeSheetEntry).set(code ? { ...changes, barcodeId: code.id } : changes).where(eq(kempoInventoryBarcodeSheetEntry.id, line.id));
      }
      await touch(tx, sheet.id);
    });
    return [null, { success: true }];
  } catch {
    return failed('Failed to change the line');
  }
};

export const removeEntry = async (sheetId, entryId, { userId, manage }) => {
  try {
    const sheet = await loadSheet(sheetId, { userId, manage });
    if(!sheet) return notFound();
    const removed = await db.transaction(async tx => {
      const rows = await tx.delete(kempoInventoryBarcodeSheetEntry)
        .where(and(eq(kempoInventoryBarcodeSheetEntry.id, String(entryId)), eq(kempoInventoryBarcodeSheetEntry.sheetId, sheet.id))).returning();
      if(rows.length) await touch(tx, sheet.id);
      return rows.length;
    });
    return removed ? [null, { success: true }] : [{ code: 404, msg: 'Line not found' }, null];
  } catch {
    return failed('Failed to remove the line');
  }
};

/*
  The sheet laid out for printing: what the print page draws. Lines whose item or code is gone are left out.
  Resolves to [null, { title, layout, config }] with a layout whose labels are { code, name, showText }.
*/
export const getPrintout = async (id, who) => {
  const [error, data] = await getSheet(id, who);
  if(error) return [error, null];
  const config = await getConfig();
  const [layoutError, layout] = layoutSheet(
    data.entries.filter(entry => !entry.missing).map(entry => ({ quantity: entry.quantity, code: entry.code, name: entry.labelText, showText: entry.showText })),
    config,
  );
  if(layoutError) return [layoutError, null];
  return [null, { title: data.sheet.name, layout, config }];
};
