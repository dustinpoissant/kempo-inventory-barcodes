import { authorizeUser } from '../../../server/http/authorize.js';
import { getPrintout } from '../../../server/utils/sheets.js';
import { renderSheetDocument, escapeHtml } from '../../../server/utils/render.js';

const sendPage = (response, code, body) => {
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.status(code);
  response.end(body);
};

const notice = (title, message, signIn = false) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(title)}</title></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p><p>${signIn ? '<a href="/login/">Sign in</a> &middot; ' : ''}<a href="/inventory-barcodes/">Your print sheets</a></p></main></body></html>`;

/*
  The sheet as a page of labels, ready to print: /inventory-barcodes/print/<sheet id>. It is the same page on
  the phone that built the sheet and on the computer with the printer, because the sheet lives on the server.
*/
export default async (request, response) => {
  const [authError, who] = await authorizeUser(request);
  if(authError) return sendPage(response, authError.code, notice(authError.code === 401 ? 'Sign in to print' : 'Not allowed', authError.msg, authError.code === 401));

  const [error, printout] = await getPrintout(request.params.id, who);
  if(error) return sendPage(response, error.code, notice(error.code === 404 ? 'Sheet not found' : 'Cannot print this sheet', error.msg));
  sendPage(response, 200, renderSheetDocument(printout));
};
