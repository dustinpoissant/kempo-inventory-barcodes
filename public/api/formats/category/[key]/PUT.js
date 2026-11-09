import { authorizeRead } from '../../../../../server/http/authorize.js';
import { saveFormat } from '../../../../../server/utils/formats.js';

/* { format } sets the format of a category; an empty format clears it, so the site default applies again. */
export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  if(!who.manage) return response.status(403).json({ error: 'Insufficient permissions' });

  const [error, saved] = await saveFormat({ scope: 'category', key: decodeURIComponent(request.params.key), format: request.body?.format });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(saved);
};
