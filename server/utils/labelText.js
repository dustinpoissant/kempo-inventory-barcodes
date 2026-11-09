/*
  The text printed above a label, built from a format. Nothing here touches the database.

  A placeholder is one or more alternatives in braces, the first with something to show wins:

    {name}                       the item's name
    {attribute:brand}            an attribute, named by its field's label in lower case, spaces as dashes
    {attribute:brand|name}       the brand, or the name when the item has no brand
    {attribute:finish|"Matte"}   the finish, or the word Matte when there is none

  The alternatives are name, sku, category, attribute:Label and "literal text". An attribute is one of the item's
  fields that applies to it (its category's, and the ones for every item), matched by label, so "Brand" fills
  attribute:brand for a paint and for a clear coat, whose field keys differ. Photos and colours are never printed.

  A placeholder with nothing to show and no fallback leaves nothing, and the separator beside it goes too, so no
  label reads "Brand -  - Name".
*/

export const DEFAULT_TEMPLATE = '{name}';
export const MAX_FORMAT = 200;

const SEPARATORS = '-–|·,/';
const SEPARATOR_CLASS = `[${SEPARATORS.replace(/[\]\\^-]/g, '\\$&')}]`;
const SEPARATOR_EDGE = `[\\s${SEPARATORS.replace(/[\]\\^-]/g, '\\$&')}]`;

export const slugOf = label => String(label ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');

const PRINTABLE = new Set(['text', 'longtext', 'number', 'choice', 'rating', 'date']);

/* A category compares the way kempo-inventory's does: spacing and case do not matter. */
export const categoryKeyOf = value => String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();

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

/* What one alternative shows for an item, or '' when it has nothing. */
const valueOf = (alternative, item, attributes) => {
  const text = alternative.trim();
  if(text.length >= 2 && text.startsWith('"') && text.endsWith('"')) return text.slice(1, -1);
  if(text.startsWith('attribute:')) return attributes[slugOf(text.slice('attribute:'.length))] ?? '';
  if(text === 'name') return String(item.name ?? '').trim();
  if(text === 'sku') return String(item.sku ?? '').trim();
  if(text === 'category') return String(item.category ?? '').trim();
  return '';
};

/*
  Says why a format cannot be used, or null when it can: the braces must pair up, every placeholder must name something
  this module knows, and the whole format must fit in MAX_FORMAT characters.
*/
export const formatProblem = format => {
  const text = String(format ?? '');
  if(text.length > MAX_FORMAT) return `A label format can be at most ${MAX_FORMAT} characters`;
  if(/[{}]/.test(text.replace(/\{[^{}]*\}/g, ''))) return 'The braces do not pair up: each { needs its }';
  for(const [, body] of text.matchAll(/\{([^{}]*)\}/g)){
    for(const alternative of body.split('|')){
      const part = alternative.trim();
      if(part.length >= 2 && part.startsWith('"') && part.endsWith('"')) continue;
      if(part === 'name' || part === 'sku' || part === 'category') continue;
      if(part.startsWith('attribute:') && slugOf(part.slice('attribute:'.length))) continue;
      return `"${part || '(empty)'}" is not a placeholder: use name, sku, category, attribute:Label or "text"`;
    }
  }
  return null;
};

/* The format filled in for one item. Empty placeholders drop out with their separators. */
export const labelTextOf = (format, item, fields) => {
  const attributes = attributesOf(item, fields);
  const filled = String(format || DEFAULT_TEMPLATE).replace(/\{([^{}]*)\}/g, (_, body) => {
    for(const alternative of body.split('|')){
      const value = valueOf(alternative, item, attributes);
      if(value) return value;
    }
    return '';
  });
  return filled
    .replace(/\s+/g, ' ')
    .replace(new RegExp(`\\s*(${SEPARATOR_CLASS})(?:\\s*${SEPARATOR_CLASS})+\\s*`, 'g'), (_, first) => ` ${first} `)
    .replace(new RegExp(`^${SEPARATOR_EDGE}+|${SEPARATOR_EDGE}+$`, 'g'), '')
    .trim();
};
