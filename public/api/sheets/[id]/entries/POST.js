import { authorizeUser } from '../../../../../server/http/authorize.js';
import { addEntry, getSheet } from '../../../../../server/utils/sheets.js';

/* { itemId, quantity?, barcodeId?, showText? }. Answers with the sheet as it now stands. */
export default async (request, response) => {
  const [authError, who] = await authorizeUser(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const { itemId, quantity, barcodeId, showText } = request.body || {};
  const [error] = await addEntry(request.params.id, { userId: who.userId, manage: who.manage, itemId, quantity, barcodeId, showText });
  if(error) return response.status(error.code).json({ error: error.msg });
  const [sheetError, data] = await getSheet(request.params.id, who);
  if(sheetError) return response.status(sheetError.code).json({ error: sheetError.msg });
  response.status(201).json(data);
};
