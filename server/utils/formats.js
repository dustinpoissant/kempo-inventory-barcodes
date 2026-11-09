import { eq, and } from 'drizzle-orm';
import db from 'kempo/server/db/index.js';
import { getItems, getFields, getItem } from 'kempo-inventory/sdk';
import { kempoInventoryBarcodeFormat } from '../db/schema.js';
import { categoryKeyOf, formatProblem, labelTextOf, DEFAULT_TEMPLATE } from './labelText.js';
import { getConfig } from './config.js';

/*
  Where a label's format comes from, most specific first: the item's own format, then its category's, then the site's
  default (the label_format setting). Every function resolves to [error, result] and never throws.
*/

const failed = msg => [{ code: 500, msg }, null];

/* Every stored format: { category: { key: format }, item: { id: format } }. */
export const storedFormats = async () => {
  try {
    const rows = await db.select().from(kempoInventoryBarcodeFormat);
    const stored = { category: {}, item: {} };
    for(const row of rows) stored[row.scope][row.key] = row.format;
    return [null, stored];
  } catch {
    return failed('Failed to read the label formats');
  }
};

/* The format that applies to an item, and which level it came from. Pure: it takes what storedFormats returned. */
export const formatFor = (item, stored, siteFormat) => {
  if(stored.item[item.id]) return { format: stored.item[item.id], source: 'item' };
  const key = categoryKeyOf(item.category);
  if(key && stored.category[key]) return { format: stored.category[key], source: 'category' };
  return { format: siteFormat || DEFAULT_TEMPLATE, source: 'site' };
};

/* The label text of an item, with the format it used and where that format came from. */
export const labelFor = (item, fields, stored, siteFormat) => {
  const { format, source } = formatFor(item, stored, siteFormat);
  return { text: labelTextOf(format, item, fields), format, source };
};

/* Sets (or, with an empty format, clears) the format of a category or an item. Refuses a format that cannot be used. */
export const saveFormat = async ({ scope, key, format }) => {
  if(!['category', 'item'].includes(scope)) return [{ code: 400, msg: 'A format is for a category or an item' }, null];
  if(!key) return [{ code: 400, msg: 'A category or an item is required' }, null];
  const text = String(format ?? '').trim();
  if(text){
    const problem = formatProblem(text);
    if(problem) return [{ code: 400, msg: problem }, null];
  }
  try {
    if(!text){
      await db.delete(kempoInventoryBarcodeFormat).where(and(eq(kempoInventoryBarcodeFormat.scope, scope), eq(kempoInventoryBarcodeFormat.key, key)));
      return [null, { scope, key, format: '' }];
    }
    await db.insert(kempoInventoryBarcodeFormat).values({ scope, key, format: text, updated: new Date() })
      .onConflictDoUpdate({ target: [kempoInventoryBarcodeFormat.scope, kempoInventoryBarcodeFormat.key], set: { format: text, updated: new Date() } });
    return [null, { scope, key, format: text }];
  } catch {
    return failed('Failed to save the label format');
  }
};

/*
  The categories the inventory has, each with how many items it holds, a sample item to preview with, and its own format.
  Items with no category are grouped under ''.
*/
export const categoriesWithFormats = async () => {
  const groups = new Map();
  for(let offset = 0; ; offset += 200){
    const [error, page] = await getItems({ limit: 200, offset });
    if(error) return [error, null];
    for(const item of page.items){
      const key = categoryKeyOf(item.category);
      if(!groups.has(key)) groups.set(key, { key, name: String(item.category ?? '').trim(), count: 0, sample: { id: item.id, name: item.name } });
      groups.get(key).count++;
    }
    if(offset + 200 >= page.total) break;
  }
  const [storedError, stored] = await storedFormats();
  if(storedError) return [storedError, null];
  const categories = [...groups.values()]
    .map(group => ({ key: group.key, name: group.name || 'Uncategorised', count: group.count, sample: group.sample, format: stored.category[group.key] ?? '' }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return [null, categories];
};

/* The label a sample or a given item would print with the format the user is typing, for the preview. */
export const previewFor = async ({ format, itemId }) => {
  const problem = formatProblem(format);
  if(problem) return [{ code: 400, msg: problem }, null];
  const [itemError, item] = await getItem(itemId);
  if(itemError) return [itemError, null];
  const [fieldsError, fields] = await getFields();
  if(fieldsError) return [fieldsError, null];
  return [null, { text: labelTextOf(format, item, fields), item: { id: item.id, name: item.name } }];
};

/* Everything a label needs to know about the formats: the site default and the stored rows. */
export const formatContext = async () => {
  const config = await getConfig();
  const [error, stored] = await storedFormats();
  if(error) return [error, null];
  const [fieldsError, fields] = await getFields();
  if(fieldsError) return [fieldsError, null];
  return [null, { siteFormat: config.labelFormat, stored, fields }];
};
