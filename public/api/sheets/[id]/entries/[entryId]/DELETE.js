import { authorizeUser } from '../../../../../../server/http/authorize.js';
import { removeEntry, getSheet } from '../../../../../../server/utils/sheets.js';

/* Answers with the sheet as it now stands. */
export default async (request, response) => {
  const [authError, who] = await authorizeUser(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error] = await removeEntry(request.params.id, request.params.entryId, who);
  if(error) return response.status(error.code).json({ error: error.msg });
  const [sheetError, data] = await getSheet(request.params.id, who);
  if(sheetError) return response.status(sheetError.code).json({ error: sheetError.msg });
  response.json(data);
};
