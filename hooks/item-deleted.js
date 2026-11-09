import { removeForItem } from '../server/utils/barcodes.js';

/* An item that is gone takes its barcodes, and its lines on every print sheet, with it. */
export default async ({ item }) => {
  if(item?.id) await removeForItem(item.id);
};
