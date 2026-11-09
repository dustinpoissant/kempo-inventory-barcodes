import { authorizeRead, requireCan } from '../../../server/http/authorize.js';
import { mergeItems } from '../../../server/utils/merge.js';

/*
  { fromId, intoId }: everything of the first item (codes, SKU, sheet lines, quantity) moves to the second,
  and the first is deleted. Deleting is part of it, so it needs the permission to delete items.
*/
export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  for(const permission of ['items:update', 'items:delete']){
    const forbidden = await requireCan(who, permission);
    if(forbidden) return response.status(forbidden.code).json({ error: forbidden.msg });
  }

  const { fromId, intoId } = request.body || {};
  const [error, result] = await mergeItems({ fromId, intoId, userId: who.userId });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(result);
};
