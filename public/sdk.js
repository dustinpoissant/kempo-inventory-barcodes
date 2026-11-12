import { request } from '/kempo/fetch.js';

const BASE = '/inventory-barcodes/api';

const enc = encodeURIComponent;

/*
  Codes. Every function resolves to [error, result]; an error carries `code` (the HTTP status) and `msg`, and
  for a refused code also `conflictItemId` (another item has it) or `mistyped` (its last digit is wrong).
*/
export const getConfig = () => request('GET', `${BASE}/config`);
export const lookup = code => request('GET', `${BASE}/lookup?code=${enc(code)}`);
export const getCodes = itemId => request('GET', `${BASE}/items/${enc(itemId)}/barcodes`);
export const addCode = (itemId, data) => request('POST', `${BASE}/items/${enc(itemId)}/barcodes`, data);
export const generateCode = itemId => request('POST', `${BASE}/items/${enc(itemId)}/barcodes`, { generate: true });
export const setPrimary = id => request('PATCH', `${BASE}/barcodes/${enc(id)}`, { primary: true });
export const removeCode = id => request('DELETE', `${BASE}/barcodes/${enc(id)}`);
export const mergeItems = (fromId, intoId) => request('POST', `${BASE}/merge`, { fromId, intoId });
export const adoptSkus = () => request('POST', `${BASE}/import-skus`, {});

/*
  Print sheets. The calls that change a sheet answer with the sheet as it now stands: { sheet, entries, summary }.
*/
export const listSheets = ({ all = false } = {}) => request('GET', `${BASE}/sheets${all ? '?all=true' : ''}`);
export const createSheet = name => request('POST', `${BASE}/sheets`, { name });
export const getSheet = id => request('GET', `${BASE}/sheets/${enc(id)}`);
export const renameSheet = (id, name) => request('PATCH', `${BASE}/sheets/${enc(id)}`, { name });
export const deleteSheet = id => request('DELETE', `${BASE}/sheets/${enc(id)}`);
export const addEntry = (sheetId, data) => request('POST', `${BASE}/sheets/${enc(sheetId)}/entries`, data);
export const updateEntry = (sheetId, entryId, data) => request('PATCH', `${BASE}/sheets/${enc(sheetId)}/entries/${enc(entryId)}`, data);
export const removeEntry = (sheetId, entryId) => request('DELETE', `${BASE}/sheets/${enc(sheetId)}/entries/${enc(entryId)}`);

/* Where a sheet prints, and the pages that edit things. */
export const printUrl = id => `/inventory-barcodes/print/${enc(id)}`;
export const sheetUrl = id => `/inventory-barcodes/sheet?id=${enc(id)}`;
export const itemUrl = id => `/inventory-barcodes/item?id=${enc(id)}`;

/*
  Label formats: the site's default, every category with its own format, and the format of one item. An empty format
  clears one, so the level above applies again. `previewFormat` answers the text a format would print for an item.
*/
export const getFormats = () => request('GET', `${BASE}/formats`);
export const setCategoryFormat = (key, format) => request('PUT', `${BASE}/formats/category/${enc(key)}`, { format });
export const setItemFormat = (id, format) => request('PUT', `${BASE}/formats/item/${enc(id)}`, { format });
export const previewFormat = (format, itemId) => request('POST', `${BASE}/formats/preview`, { format, itemId });
