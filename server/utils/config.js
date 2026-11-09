import { getSetting } from 'kempo/server/sdk.js';
import { cleanPrefix } from './codes.js';

export const OWNER = 'kempo-inventory-barcodes';

const asBoolean = value => value === true || value === 'true';

/* A number of at least `min`, or the default when the setting is blank or nonsense. */
const asNumber = (value, fallback, min = 0) => {
  const number = value === '' || value === null ? NaN : Number(value);
  return Number.isFinite(number) && number >= min ? number : fallback;
};

/*
  The label and paper sizes (inches) as the settings hold them, always usable: a setting that is blank or not a
  number falls back to its default, so a bad edit in the admin cannot break printing.
*/
export const getConfig = async () => {
  const read = async (name, fallback) => (await getSetting(OWNER, name, fallback))[1] ?? fallback;
  return {
    sheetWidth: asNumber(await read('sheet_width', 8.5), 8.5, 1),
    sheetHeight: asNumber(await read('sheet_height', 11), 11, 1),
    sheetMargin: asNumber(await read('sheet_margin', 0.5), 0.5),
    labelWidth: asNumber(await read('label_width', 2.5), 2.5, 0.5),
    labelHeight: asNumber(await read('label_height', 1), 1, 0.4),
    labelGap: asNumber(await read('label_gap', 0), 0),
    labelText: asBoolean(await read('label_text', true)),
    labelTextSize: asNumber(await read('label_text_size', 9), 9, 4),
    cutGuides: asBoolean(await read('label_cut_guides', true)),
    internalPrefix: cleanPrefix(await read('internal_prefix', 'INV')),
  };
};
