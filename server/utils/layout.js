/*
  Where labels go on the paper. All sizes are inches. Nothing here touches the database.
*/

const EPSILON = 1e-6;

/* How many labels of `size` fit in `room`, with `gap` between them. */
const fit = (room, size, gap) => (size > 0 ? Math.floor((room + gap + EPSILON) / (size + gap)) : 0);

/*
  The grid one page holds, or an error sentence when not even one label fits.

    { columns, rows, perPage }
*/
export const gridOf = ({ sheetWidth, sheetHeight, sheetMargin, labelWidth, labelHeight, labelGap }) => {
  const columns = fit(sheetWidth - sheetMargin * 2, labelWidth, labelGap);
  const rows = fit(sheetHeight - sheetMargin * 2, labelHeight, labelGap);
  if(columns < 1 || rows < 1) return [{ code: 400, msg: 'A label is bigger than the printable part of the paper. Make the label smaller or the margin narrower in the settings.' }, null];
  return [null, { columns, rows, perPage: columns * rows }];
};

/*
  Spreads a sheet's entries over pages. An entry with a quantity of 3 becomes 3 labels, side by side, and the
  next entry carries on straight after it, so no paper is wasted on part-filled pages between entries.

    entries: [{ quantity, ...whatTheLabelNeeds }]
    resolves to [null, { columns, rows, perPage, total, pages: [[label, ...], ...] }]
*/
export const layoutSheet = (entries, config) => {
  const [error, grid] = gridOf(config);
  if(error) return [error, null];
  const labels = entries.flatMap(entry => Array.from({ length: Math.max(0, entry.quantity) }, () => entry));
  const pages = [];
  for(let start = 0; start < labels.length; start += grid.perPage) pages.push(labels.slice(start, start + grid.perPage));
  return [null, { ...grid, total: labels.length, pages }];
};
