import { authorizeRead, requireCan } from '../../../../server/http/authorize.js';
import { setPrimary } from '../../../../server/utils/barcodes.js';

/* { primary: true } makes this the code the item prints by default. */
export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const forbidden = await requireCan(who, 'items:update');
  if(forbidden) return response.status(forbidden.code).json({ error: forbidden.msg });

  if(request.body?.primary !== true) return response.status(400).json({ error: 'Send { "primary": true }' });
  const [error, result] = await setPrimary(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(result);
};
