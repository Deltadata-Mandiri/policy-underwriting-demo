import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from 'aws-lambda';
import { env } from '$amplify/env/conductor-proxy';

/*
 * Port of server.js. The Orkes key/secret stay in Lambda env (Amplify secrets);
 * the browser only sees the three /api/* routes below.
 */

// Secret values can pick up a BOM / stray whitespace depending on how they were
// piped into `ampx secret set`, so scrub them rather than trusting them raw.
const clean = (v: string) => v.replace(/^﻿/, '').trim();

const SERVER_URL = clean(env.CONDUCTOR_SERVER_URL).replace(/\/+$/, '');
const AUTH_KEY = clean(env.CONDUCTOR_AUTH_KEY);
const AUTH_SECRET = clean(env.CONDUCTOR_AUTH_SECRET);
const WORKFLOW_NAME = env.WORKFLOW_NAME;
const WORKFLOW_VERSION = env.WORKFLOW_VERSION;
const REVIEW_TASK_REF = env.REVIEW_TASK_REF;

// Cached across warm invocations, same as the old in-process cache.
let cachedToken: string | null = null;

async function getToken(): Promise<string> {
  if (cachedToken) return cachedToken;
  const res = await fetch(`${SERVER_URL}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyId: AUTH_KEY, keySecret: AUTH_SECRET }),
  });
  if (!res.ok) {
    throw new Error(`Token exchange failed (${res.status}): ${await res.text()}`);
  }
  const json = (await res.json()) as { token: string };
  cachedToken = json.token;
  return cachedToken;
}

async function conductor(
  pathAndQuery: string,
  options: RequestInit = {},
  retry = true
): Promise<Response> {
  const token = await getToken();
  const res = await fetch(`${SERVER_URL}${pathAndQuery}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
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

async function startApplication(input: unknown) {
  const res = await conductor(
    `/workflow/${encodeURIComponent(WORKFLOW_NAME)}?version=${WORKFLOW_VERSION}`,
    { method: 'POST', body: JSON.stringify(input) }
  );
  const text = (await res.text()).trim();
  if (!res.ok) throw new Error(`Start failed (${res.status}): ${text}`);
  // Orkes returns the workflowId as a bare string (sometimes JSON-quoted).
  return { workflowId: text.replace(/^"|"$/g, '') };
}

async function getApplication(id: string) {
  const res = await conductor(`/workflow/${encodeURIComponent(id)}?includeTasks=true`);
  const text = await res.text();
  if (!res.ok) throw new Error(`Status failed (${res.status}): ${text}`);
  const wf = JSON.parse(text);
  // Is the workflow currently paused on the underwriter-review WAIT task?
  const awaitingReview = Array.isArray(wf.tasks)
    ? wf.tasks.some(
        (t: any) =>
          t.referenceTaskName === REVIEW_TASK_REF &&
          (t.status === 'IN_PROGRESS' || t.status === 'SCHEDULED')
      )
    : false;
  return {
    workflowId: wf.workflowId,
    status: wf.status,
    awaitingReview,
    output: wf.output || {},
  };
}

async function submitReview(id: string, decision: unknown) {
  const res = await conductor(
    `/tasks/${encodeURIComponent(id)}/${encodeURIComponent(REVIEW_TASK_REF)}/COMPLETED`,
    { method: 'POST', body: JSON.stringify(decision) }
  );
  if (!res.ok) throw new Error(`Review signal failed (${res.status}): ${await res.text()}`);
  return { ok: true };
}

const json = (statusCode: number, body: unknown): APIGatewayProxyResultV2 => ({
  statusCode,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export const handler = async (
  event: APIGatewayProxyEventV2
): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method;
  const path = event.rawPath.split('?')[0];

  try {
    if (path === '/api/applications' && method === 'POST') {
      return json(200, await startApplication(JSON.parse(event.body || '{}')));
    }

    const statusMatch = path.match(/^\/api\/applications\/([^/]+)$/);
    if (statusMatch && method === 'GET') {
      return json(200, await getApplication(decodeURIComponent(statusMatch[1])));
    }

    const reviewMatch = path.match(/^\/api\/applications\/([^/]+)\/review$/);
    if (reviewMatch && method === 'POST') {
      return json(
        200,
        await submitReview(decodeURIComponent(reviewMatch[1]), JSON.parse(event.body || '{}'))
      );
    }

    return json(404, { error: 'Unknown endpoint' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[api error]', message);
    return json(502, { error: message });
  }
};
