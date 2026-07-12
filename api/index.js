/**
 * Vercel serverless entry — runs Angular SSR Express (incl. /api/kite proxy).
 */
export default async function handler(req, res) {
  const { reqHandler } = await import('../dist/palagai/server/server.mjs');
  return reqHandler(req, res);
}
