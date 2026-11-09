/*
  The server SDK for other extensions and for a site's own routes. Every function resolves to [error, result].

    import { findByCode, ensurePrimary } from 'kempo-inventory-barcodes/sdk';

    const [error, found] = await findByCode(scannedText);   // { item, barcode, via }

  A site's scanner should use findByCode (or GET /inventory-barcodes/api/lookup?code=) instead of comparing the
  scan with item SKUs, so a bin labelled with any of an item's codes opens the item.
*/
export {
  findByCode,
  getCodes,
  getCodesForItems,
  addCode,
  makeInternalCode,
  ensurePrimary,
  setPrimary,
  removeCode,
  adoptSkus,
} from './server/utils/barcodes.js';

export { mergeItems } from './server/utils/merge.js';
export { cleanCode, lookupKey, isGtin, kindOf, symbologyFor } from './server/utils/codes.js';
export { barcodeSvg } from './server/utils/render.js';
