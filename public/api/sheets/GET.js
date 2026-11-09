import { authorizeUser } from '../../../server/http/authorize.js';
import { listSheets } from '../../../server/utils/sheets.js';

/* The caller's own sheets. ?all=true lists everyone's, for administrators. */
export default async (request, response) => {
  const [authError, who] = await authorizeUser(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const all = request.query.all === 'true';
  if(all && !who.manage) return response.status(403).json({ error: 'Insufficient permissions' });

  const [error, data] = await listSheets({ userId: who.userId, manage: who.manage, all });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(data);
};
