// Suppress Node.js deprecation warnings
process.removeAllListeners('warning');
const originalEmitWarning = process.emitWarning.bind(process);
(process as any).emitWarning = function(warning: string | Error, options?: NodeJS.EmitWarningOptions) {
  if (warning && typeof warning === 'object' && 'name' in warning && warning.name === 'DeprecationWarning') {
    if ('message' in warning && typeof warning.message === 'string' && warning.message.includes('url.parse()')) {
      return;
    }
  }
  return originalEmitWarning(warning, options);
};

import {
  AngularNodeAppEngine,
  createNodeRequestHandler,
  isMainModule,
  writeResponseToNodeResponse,
} from '@angular/ssr/node';
import { createHash } from 'node:crypto';
import express from 'express';
import { gunzipSync } from 'node:zlib';
import { join } from 'node:path';

const KITE_API_BASE_URL = 'https://api.kite.trade';

const browserDistFolder = join(import.meta.dirname, '../browser');

const app = express();
const angularApp = new AngularNodeAppEngine();

function asFormRecord(body: unknown): Record<string, string> {
  if (!body || typeof body !== 'object' || Buffer.isBuffer(body)) {
    return {};
  }
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
    if (value == null) {
      continue;
    }
    out[key] = Array.isArray(value) ? String(value[0] ?? '') : String(value);
  }
  return out;
}

function buildSessionTokenBody(fields: Record<string, string>): string {
  const apiKey = fields['api_key']?.trim() ?? '';
  const requestToken = fields['request_token']?.trim() ?? '';
  const apiSecret = fields['api_secret']?.trim() ?? '';
  let checksum = fields['checksum']?.trim() ?? '';

  // Prefer server-side checksum whenever api_secret is present (avoids client/proxy mismatches).
  if (apiKey && requestToken && apiSecret) {
    checksum = createHash('sha256')
      .update(`${apiKey}${requestToken}${apiSecret}`, 'utf8')
      .digest('hex');
  }

  const params = new URLSearchParams();
  params.set('api_key', apiKey);
  params.set('request_token', requestToken);
  params.set('checksum', checksum);
  return params.toString();
}

const kiteApiRouter = express.Router();
kiteApiRouter.use(express.urlencoded({ extended: false }));
kiteApiRouter.use((req, _res, next) => {
  // Vercel sometimes leaves a raw querystring on req.body.
  if (typeof req.body === 'string' && req.body.includes('=')) {
    req.body = Object.fromEntries(new URLSearchParams(req.body));
  }
  next();
});

kiteApiRouter.use(async (req, res) => {
  const targetUrl = `${KITE_API_BASE_URL}${req.url}`;
  const headers: Record<string, string> = {
    'X-Kite-Version': '3',
  };

  if (typeof req.headers.authorization === 'string') {
    headers['Authorization'] = req.headers.authorization;
  }

  const init: RequestInit = {
    method: req.method,
    headers,
  };

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
    const fields = asFormRecord(req.body);
    const isSessionToken =
      req.url === '/session/token' || req.url.startsWith('/session/token?');

    init.body = isSessionToken
      ? buildSessionTokenBody(fields)
      : new URLSearchParams(fields).toString();
  }

  try {
    const kiteResponse = await fetch(targetUrl, init);

    if (req.method === 'GET' && req.url.startsWith('/instruments')) {
      const buffer = Buffer.from(await kiteResponse.arrayBuffer());
      let csv = '';
      try {
        csv = gunzipSync(buffer).toString('utf-8');
      } catch {
        csv = buffer.toString('utf-8');
      }
      res.status(kiteResponse.status).type('text/csv').send(csv);
      return;
    }

    const responseText = await kiteResponse.text();
    let responseBody: unknown = responseText;

    try {
      responseBody = JSON.parse(responseText);
    } catch {
      // Keep raw text when Kite does not return JSON.
    }

    res.status(kiteResponse.status).send(responseBody);
  } catch {
    res.status(502).json({
      status: 'error',
      message: 'Failed to reach Kite API.',
    });
  }
});

app.use('/api/kite', kiteApiRouter);

/**
 * Serve static files from /browser
 */
app.use(
  express.static(browserDistFolder, {
    maxAge: '1y',
    index: false,
    redirect: false,
  }),
);

/**
 * Handle all other requests by rendering the Angular application.
 */
app.use((req, res, next) => {
  angularApp
    .handle(req)
    .then((response) =>
      response ? writeResponseToNodeResponse(response, res) : next(),
    )
    .catch(next);
});

/**
 * Start the server if this module is the main entry point, or it is ran via PM2.
 * The server listens on the port defined by the `PORT` environment variable, or defaults to 4000.
 */
if (isMainModule(import.meta.url) || process.env['pm_id']) {
  const port = process.env['PORT'] || 4000;
  app.listen(port, (error) => {
    if (error) {
      throw error;
    }

    console.log(`Node Express server listening on http://localhost:${port}`);
  });
}

/**
 * Request handler used by the Angular CLI (for dev-server and during build) or Firebase Cloud Functions.
 */
export const reqHandler = createNodeRequestHandler(app);
