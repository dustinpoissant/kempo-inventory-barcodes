import { authorizeRead, requireCan } from '../../../../server/http/authorize.js';
import { removeCode } from '../../../../server/utils/barcodes.js';

export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const forbidden = await requireCan(who, 'items:update');
  if(forbidden) return response.status(forbidden.code).json({ error: forbidden.msg });

  const [error, result] = await removeCode(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(result);
};
