import { authorizeRead } from '../../../../../server/http/authorize.js';
import { getCodes } from '../../../../../server/utils/barcodes.js';
import { getItem } from 'kempo-inventory/sdk';
import { formatContext, labelFor } from '../../../../../server/utils/formats.js';

/* The item's codes, and the label it prints: the text, the format that made it and where that format came from. */
export default async (request, response) => {
  const [authError] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, codes] = await getCodes(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  const [itemError, item] = await getItem(request.params.id);
  if(itemError) return response.status(itemError.code).json({ error: itemError.msg });
  const [contextError, context] = await formatContext();
  if(contextError) return response.status(contextError.code).json({ error: contextError.msg });
  response.json({ codes, label: labelFor(item, context.fields, context.stored, context.siteFormat) });
};
