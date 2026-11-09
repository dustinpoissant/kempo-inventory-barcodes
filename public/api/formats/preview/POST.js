import { authorizeRead } from '../../../../server/http/authorize.js';
import { previewFor } from '../../../../server/utils/formats.js';

/* { format, itemId } answers the label text that format would print for that item, before anything is saved. */
export default async (request, response) => {
  const [authError] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const [error, preview] = await previewFor({ format: request.body?.format ?? '', itemId: request.body?.itemId });
  if(error) return response.status(error.code).json({ error: error.msg });
  response.json(preview);
};
