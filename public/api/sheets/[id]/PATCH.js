import { authorizeUser } from '../../../../server/http/authorize.js';
import { renameSheet } from '../../../../server/utils/sheets.js';

export default async (request, response) => {
  const [authError, who] = await authorizeUser(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, data] = await renameSheet(request.params.id, { userId: who.userId, manage: who.manage, name: request.body?.name });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(data);
};
