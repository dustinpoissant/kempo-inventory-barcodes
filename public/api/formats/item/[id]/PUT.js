import { authorizeRead, requireCan } from '../../../../../server/http/authorize.js';
import { saveFormat } from '../../../../../server/utils/formats.js';

/* { format } sets the format of one item, overriding its category's; an empty format clears it. */
export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const forbidden = await requireCan(who, 'items:update');
  if(forbidden) return response.status(forbidden.code).json({ error: forbidden.msg });

  const [error, saved] = await saveFormat({ scope: 'item', key: request.params.id, format: request.body?.format });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(saved);
};
