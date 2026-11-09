import { sql } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';

/*
  A fresh install builds each table from its columns only (createTablesFromSchema), so the indexes declared
  in server/db/schema.js are created here with the same names; an update that finds them present adds
  nothing. The unique ones are correctness guarantees: one code can never open two items, an item has one
  primary code and at most one made-up code, and a sheet has one line per code.
*/
const INDEXES = [
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryBarcodeLookupIdx" ON "kempoInventoryBarcode" ("lookup")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoInventoryBarcodeItemIdx" ON "kempoInventoryBarcode" ("itemId")`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryBarcodePrimaryIdx" ON "kempoInventoryBarcode" ("itemId") WHERE "isPrimary"`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryBarcodeInternalIdx" ON "kempoInventoryBarcode" ("itemId") WHERE "kind" = 'internal'`,
  sql`CREATE INDEX IF NOT EXISTS "kempoInventoryBarcodeSheetUserIdx" ON "kempoInventoryBarcodeSheet" ("userId")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoInventoryBarcodeSheetEntrySheetIdx" ON "kempoInventoryBarcodeSheetEntry" ("sheetId")`,
  sql`CREATE INDEX IF NOT EXISTS "kempoInventoryBarcodeSheetEntryItemIdx" ON "kempoInventoryBarcodeSheetEntry" ("itemId")`,
  sql`CREATE UNIQUE INDEX IF NOT EXISTS "kempoInventoryBarcodeSheetEntryCodeIdx" ON "kempoInventoryBarcodeSheetEntry" ("sheetId", "barcodeId")`,
];

export default async () => {
  for(const statement of INDEXES) await db.execute(statement);
};
