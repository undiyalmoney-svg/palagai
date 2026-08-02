/**
 * Vercel serverless entry — runs Angular SSR Express (incl. /api/kite proxy).
 *
 * vercel.json rewrites every path to /api, which can wipe the browser path/query
 * from req.url. Restore them so Kite ?request_token= and dashboard routes work.
 */
export default async function handler(req, res) {
  const forwarded = req.headers['x-forwarded-uri'];
  const invokePath = req.headers['x-invoke-path'];
  const invokeQuery = req.headers['x-invoke-query'];

  if (typeof forwarded === 'string' && forwarded.startsWith('/')) {
    req.url = forwarded;
    if (!req.originalUrl) {
      req.originalUrl = forwarded;
    }
  } else if (typeof invokePath === 'string' && invokePath.startsWith('/') && invokePath !== '/api') {
    const q =
      typeof invokeQuery === 'string' && invokeQuery.length
        ? (invokeQuery.startsWith('?') ? invokeQuery : `?${invokeQuery}`)
        : '';
    const restored = `${invokePath}${q}`;
    req.url = restored;
    if (!req.originalUrl || req.originalUrl === '/api' || req.originalUrl.startsWith('/api?')) {
      req.originalUrl = restored;
    }
  }

  const { reqHandler } = await import('../dist/palagai/server/server.mjs');
  return reqHandler(req, res);
}
