import { pgTable, text, timestamp, integer, boolean, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

/*
  A code that opens an inventory item when scanned. An item has any number of them and exactly one is
  its primary, the one that prints by default. `lookup` is `code` made comparable (see codes.js) and is
  unique across the whole table, so one code can never open two items.

  kind: 'upc' is a real product code with a valid check digit, 'internal' is the one made up for an
  item that had none (an item has at most one), anything else is 'other'.
*/
export const kempoInventoryBarcode = pgTable('kempoInventoryBarcode', {
  id: text('id').primaryKey(),
  code: text('code').notNull(),
  lookup: text('lookup').notNull(),
  itemId: text('itemId').notNull(),
  kind: text('kind').notNull(),
  isPrimary: boolean('isPrimary').notNull().default(false),
  created: timestamp('created').notNull(),
}, table => [
  uniqueIndex('kempoInventoryBarcodeLookupIdx').on(table.lookup),
  index('kempoInventoryBarcodeItemIdx').on(table.itemId),
  uniqueIndex('kempoInventoryBarcodePrimaryIdx').on(table.itemId).where(sql`${table.isPrimary}`),
  uniqueIndex('kempoInventoryBarcodeInternalIdx').on(table.itemId).where(sql`${table.kind} = 'internal'`),
]);

/*
  The last number handed out for each series of internal codes. Taken with a single upsert, so two people
  asking at once never get the same one.
*/
export const kempoInventoryBarcodeCounter = pgTable('kempoInventoryBarcodeCounter', {
  name: text('name').primaryKey(),
  value: integer('value').notNull().default(0),
});

/*
  A print sheet belongs to the person who made it. It holds as many labels as they like and is laid out
  onto pages when it is printed, so it is not itself one page.
*/
export const kempoInventoryBarcodeSheet = pgTable('kempoInventoryBarcodeSheet', {
  id: text('id').primaryKey(),
  userId: text('userId').notNull(),
  name: text('name').notNull(),
  created: timestamp('created').notNull(),
  updated: timestamp('updated').notNull(),
}, table => [index('kempoInventoryBarcodeSheetUserIdx').on(table.userId)]);

/*
  One line of a sheet: print `quantity` copies of one code of one item. `showText` is whether the item's
  name is printed above the barcode. A sheet has one line per code, so adding what is already there adds to
  its quantity, even when two people (or two devices) do it at once.
*/
export const kempoInventoryBarcodeSheetEntry = pgTable('kempoInventoryBarcodeSheetEntry', {
  id: text('id').primaryKey(),
  sheetId: text('sheetId').notNull(),
  itemId: text('itemId').notNull(),
  barcodeId: text('barcodeId').notNull(),
  quantity: integer('quantity').notNull().default(1),
  showText: boolean('showText').notNull().default(true),
  position: integer('position').notNull().default(0),
  created: timestamp('created').notNull(),
}, table => [
  index('kempoInventoryBarcodeSheetEntrySheetIdx').on(table.sheetId),
  index('kempoInventoryBarcodeSheetEntryItemIdx').on(table.itemId),
  uniqueIndex('kempoInventoryBarcodeSheetEntryCodeIdx').on(table.sheetId, table.barcodeId),
]);
