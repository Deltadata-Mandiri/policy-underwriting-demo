/*
 * BDN Life · Term-Life Underwriting — credentials proxy (backend-for-frontend)
 *
 * Purpose: keep the Orkes Conductor app key/secret SERVER-SIDE. The browser
 * never receives credentials — it only talks to this proxy's /api/* routes.
 * The proxy performs the Orkes key/secret -> token exchange and forwards
 * whitelisted calls to Conductor.
 *
 * Zero external dependencies: pure Node (>=18) using the built-in fetch + http.
 * Run:  node server.js   (after filling in .env)
 */

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Minimal .env loader (no dotenv dependency). Real process.env wins over file.
// ---------------------------------------------------------------------------
function loadEnv(file) {
  try {
    const text = fs.readFileSync(file, 'utf8');
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
      if (!m) continue;
      const key = m[1];
      let val = m[2].trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = val;
    }
  } catch (_) { /* no .env file — rely on real env vars */ }
}
loadEnv(path.join(__dirname, '.env'));

const CONFIG = {
  serverUrl: (process.env.CONDUCTOR_SERVER_URL || '').replace(/\/+$/, ''),
  authKey: process.env.CONDUCTOR_AUTH_KEY || '',
  authSecret: process.env.CONDUCTOR_AUTH_SECRET || '',
  workflowName: process.env.WORKFLOW_NAME || 'policy_underwriting',
  workflowVersion: process.env.WORKFLOW_VERSION || '1',
  reviewTaskRef: process.env.REVIEW_TASK_REF || 'underwriter_review_ref',
  port: parseInt(process.env.PORT || '4300', 10),
};

if (!CONFIG.serverUrl || !CONFIG.authKey || !CONFIG.authSecret) {
  console.warn('\n[!] Missing Conductor credentials. Copy .env.example to .env and fill in');
  console.warn('    CONDUCTOR_SERVER_URL / CONDUCTOR_AUTH_KEY / CONDUCTOR_AUTH_SECRET.\n');
}

// ---------------------------------------------------------------------------
// Conductor token cache + authenticated fetch (auto-refresh on 401).
// ---------------------------------------------------------------------------
let cachedToken = null;

async function getToken() {
  if (cachedToken) return cachedToken;
  const res = await fetch(`${CONFIG.serverUrl}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: CONFIG.authKey, keySecret: CONFIG.authSecret }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token exchange failed (${res.status}): ${body}`);
  }
  const json = await res.json();
  cachedToken = json.token;
  return cachedToken;
}

async function conductor(pathAndQuery, options = {}, retry = true) {
  const token = await getToken();
  const res = await fetch(`${CONFIG.serverUrl}${pathAndQuery}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'X-Authorization': token,
      ...(options.headers || {}),
    },
  });
  if (res.status === 401 && retry) {
    cachedToken = null; // token likely expired — refresh once
    return conductor(pathAndQuery, options, false);
  }
  return res;
}

// ---------------------------------------------------------------------------
// API handlers
// ---------------------------------------------------------------------------
async function startApplication(input) {
  const res = await conductor(
    `/workflow/${encodeURIComponent(CONFIG.workflowName)}?version=${CONFIG.workflowVersion}`,
    { method: 'POST', body: JSON.stringify(input) }
  );
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(`Start failed (${res.status}): ${text}`);
  // Orkes returns the workflowId as a bare string (sometimes JSON-quoted).
  const workflowId = text.replace(/^"|"$/g, '');
  return { workflowId };
}

async function getApplication(id) {
  const res = await conductor(`/workflow/${encodeURIComponent(id)}?includeTasks=true`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Status failed (${res.status}): ${text}`);
  const wf = JSON.parse(text);
  // Is the workflow currently paused on the underwriter-review WAIT task?
  let awaitingReview = false;
  if (Array.isArray(wf.tasks)) {
    awaitingReview = wf.tasks.some(
      (t) => t.referenceTaskName === CONFIG.reviewTaskRef &&
             (t.status === 'IN_PROGRESS' || t.status === 'SCHEDULED')
    );
  }
  return {
    workflowId: wf.workflowId,
    status: wf.status,
    awaitingReview,
    output: wf.output || {},
  };
}

async function submitReview(id, decision) {
  const res = await conductor(
    `/tasks/${encodeURIComponent(id)}/${encodeURIComponent(CONFIG.reviewTaskRef)}/COMPLETED`,
    { method: 'POST', body: JSON.stringify(decision) }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`Review signal failed (${res.status}): ${text}`);
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Tiny HTTP server: static files + /api routes
// ---------------------------------------------------------------------------
const PUBLIC_DIR = path.join(__dirname, 'public');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(body);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (c) => { data += c; if (data.length > 1e6) req.destroy(); });
    req.on('end', () => {
      if (!data) return resolve({});
      try { resolve(JSON.parse(data)); } catch (e) { reject(new Error('Invalid JSON body')); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res) {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const filePath = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!filePath.startsWith(PUBLIC_DIR)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'application/octet-stream' });
    res.end(buf);
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url.split('?')[0];
  try {
    if (url === '/api/applications' && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, await startApplication(body));
    }
    const statusMatch = url.match(/^\/api\/applications\/([^/]+)$/);
    if (statusMatch && req.method === 'GET') {
      return sendJson(res, 200, await getApplication(statusMatch[1]));
    }
    const reviewMatch = url.match(/^\/api\/applications\/([^/]+)\/review$/);
    if (reviewMatch && req.method === 'POST') {
      const body = await readBody(req);
      return sendJson(res, 200, await submitReview(reviewMatch[1], body));
    }
    if (url.startsWith('/api/')) return sendJson(res, 404, { error: 'Unknown endpoint' });
    return serveStatic(req, res);
  } catch (err) {
    console.error('[api error]', err.message);
    return sendJson(res, 502, { error: err.message });
  }
});

server.listen(CONFIG.port, () => {
  console.log(`\nBRI Life · Underwriting Console  ->  http://localhost:${CONFIG.port}`);
  console.log(`Proxying to Conductor: ${CONFIG.serverUrl || '(not configured)'}`);
  console.log(`Workflow: ${CONFIG.workflowName} v${CONFIG.workflowVersion}\n`);
});
