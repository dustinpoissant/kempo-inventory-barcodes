/*
  The text printed above a label, built from a format such as "{attribute:brand} - {attribute:finish} - {name}".
  Nothing here touches the database.

  {attribute:Label} is an attribute of the item, named by its field's label: lower case, with each run of other
  characters made a dash. The field "Manufacturer Code" is {attribute:manufacturer-code}. Attributes are the fields
  that apply to the item (its category's and the ones for every item), matched by label, so "Brand" fills
  {attribute:brand} for a paint and for a clear coat, whose field keys differ. {name}, {sku} and {category} are the
  item's own. A photo or a colour is never printed. A placeholder with nothing to show is left out together with the
  separator next to it, and an unknown one is left out.
*/

export const DEFAULT_TEMPLATE = '{attribute:brand} - {attribute:finish} - {name}';

const SEPARATORS = '-–|·,/';
const SEPARATOR_CLASS = `[${SEPARATORS.replace(/[\]\\^-]/g, '\\$&')}]`;

export const slugOf = label => String(label ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const PRINTABLE = new Set(['text', 'longtext', 'number', 'choice', 'rating', 'date']);

/* A category compares the way kempo-inventory's does: spacing and case do not matter. */
const categoryKeyOf = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

/* The item's attributes by slug, first value wins: { brand: 'Apple Barrel', finish: 'Matte', ... }. */
export const attributesOf = (item, fields) => {
  const key = categoryKeyOf(item.category);
  const attributes = {};
  for(const field of fields){
    if(!PRINTABLE.has(field.type)) continue;
    if(field.category && field.category !== key) continue;
    const slug = slugOf(field.label);
    const value = item.fields?.[field.key];
    if(!slug || value === undefined || value === null || String(value).trim() === '') continue;
    attributes[slug] ??= String(value).trim();
  }
  return attributes;
};

/* The format filled in for one item. Empty placeholders drop out with their separators, so no label reads "Brand -  - Name". */
export const labelTextOf = (template, item, fields) => {
  const attributes = attributesOf(item, fields);
  const own = { name: item.name ?? '', sku: item.sku ?? '', category: String(item.category ?? '').trim() };
  const filled = String(template || DEFAULT_TEMPLATE)
    .replace(/\{(attribute:)?([a-z0-9-]+)\}/g, (_, attribute, key) => (attribute ? attributes[key] : own[key]) ?? '');
  return filled
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`\\s*(${SEPARATOR_CLASS})(?:\\s*${SEPARATOR_CLASS})+\\s*`, 'g'), (_, first) => ` ${first} `)
    .replace(new RegExp(`^[\\s${SEPARATORS.replace(/[\]\\^-]/g, '\\$&')}]+|[\\s${SEPARATORS.replace(/[\]\\^-]/g, '\\$&')}]+$`, 'g'), '')
    .trim();
};
