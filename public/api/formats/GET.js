import { authorizeRead } from '../../../server/http/authorize.js';
import { categoriesWithFormats, storedFormats } from '../../../server/utils/formats.js';
import { getConfig } from '../../../server/utils/config.js';

/* The site's default label format and every category with its own format, for the Barcodes tab. */
export default async (request, response) => {
  const [authError, who] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, categories] = await categoriesWithFormats();
  if(error) return response.status(error.code).json({ error: error.msg });
  const config = await getConfig();
  response.json({ site: config.labelFormat, categories, canManage: who.manage });
};
