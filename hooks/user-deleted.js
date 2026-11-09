import { removeSheetsOf } from '../server/utils/sheets.js';

/* A deleted account takes its print sheets with it. */
export default async ({ id }) => {
  if(id) await removeSheetsOf(id);
};
