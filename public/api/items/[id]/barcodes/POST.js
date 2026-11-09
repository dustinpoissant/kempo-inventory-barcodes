import { authorizeRead, requireCan } from '../../../../../server/http/authorize.js';
import { addCode, makeInternalCode } from '../../../../../server/utils/barcodes.js';

/*
  Adds a code to the item: { code, makePrimary?, force? } for one that was scanned or typed, or
  { generate: true } for a made-up one. A code that belongs to another item answers 409 with the
  `conflictItemId`, so the page can offer to merge the two.
*/
export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  const forbidden = await requireCan(who, 'items:update');
  if(forbidden) return response.status(forbidden.code).json({ error: forbidden.msg });

  const { code, makePrimary, force, generate } = request.body || {};
  const [error, result] = generate
    ? await makeInternalCode(request.params.id)
    : await addCode({ itemId: request.params.id, code, makePrimary: makePrimary === true, force: force === true });
  if(error) return response.status(error.code).json({ error: error.msg, conflictItemId: error.conflictItemId, mistyped: error.mistyped });
  response.status(result.existing ? 200 : 201).json(result);
};
