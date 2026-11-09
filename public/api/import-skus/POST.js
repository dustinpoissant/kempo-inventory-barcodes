import { authorizeRead } from '../../../server/http/authorize.js';
import { adoptSkus } from '../../../server/utils/barcodes.js';

/* Gives every item whose SKU is a real product code a barcode of that text. Safe to run again. */
export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });
  if(!who.manage) return response.status(403).json({ error: 'Insufficient permissions' });

  const [error, summary] = await adoptSkus();
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(summary);
};
