import { authorizeRead, forCaller } from '../../../server/http/authorize.js';
import { findByCode, getCodes } from '../../../server/utils/barcodes.js';

/*
  ?code= is what a scanner read. Resolves to the item that code opens, whichever of the item's codes it was,
  with all of that item's codes. A site's scan page should call this instead of comparing with SKUs.
*/
export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, found] = await findByCode(request.query.code);
  if(error) return response.status(error.code).json({ error: error.msg });
  const [, codes] = await getCodes(found.item.id);
  response.json({ item: await forCaller(found.item, who), barcode: found.barcode, via: found.via, codes: codes ?? [] });
};
