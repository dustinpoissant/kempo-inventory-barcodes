import { authorizeRead } from '../../../../../server/http/authorize.js';
import { getCodes } from '../../../../../server/utils/barcodes.js';

export default async (request, response) => {
  const [authError] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, codes] = await getCodes(request.params.id);
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json({ codes });
};
