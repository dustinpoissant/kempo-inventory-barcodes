import { authorizeRead } from '../../../server/http/authorize.js';
import { getConfig } from '../../../server/utils/config.js';
import { gridOf } from '../../../server/utils/layout.js';

/* The label and paper sizes, and how many labels one page holds, for the pages that show them. */
export default async (request, response) => {
  const [authError] = await authorizeRead(request);
  if(authError) return response.status(authError.code).json({ error: authError.msg });

  const config = await getConfig();
  const [gridError, grid] = gridOf(config);
  response.json({ config, grid, gridError: gridError?.msg ?? null });
};
