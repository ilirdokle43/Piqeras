/**
 * A minimal Firestore admin client built on the REST API.
 *
 * Why not firebase-admin: the Admin SDK needs Application Default Credentials,
 * which on this machine would mean an interactive
 * `gcloud auth application-default login`. The REST API accepts the ordinary
 * gcloud access token that is already available, and — like the Admin SDK —
 * bypasses Security Rules, which is exactly what bootstrapping requires.
 *
 * These tools are the ONLY way to create the first organizer. That is by
 * design: no client, and no signed-in user of any kind, can write to
 * `organizers/**`.
 */

import { execFileSync, execSync } from 'node:child_process';

export const PROJECT = 'piqeras';

const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;

const GCLOUD =
  process.env.GCLOUD_PATH ?? 'C:/Users/Tdshm/google-cloud-sdk/bin/gcloud.cmd';

let cachedToken = null;

export function accessToken() {
  if (cachedToken) return cachedToken;
  try {
    // On Windows the gcloud entry point is a .cmd, which execFileSync has
    // refused to spawn directly since Node 20 (EINVAL). Going through the
    // shell as a single quoted command avoids both that and the argument
    // concatenation warning that `shell: true` with an args array produces.
    cachedToken =
      process.platform === 'win32'
        ? execSync(`"${GCLOUD}" auth print-access-token`, {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'pipe'],
          }).trim()
        : execFileSync(GCLOUD, ['auth', 'print-access-token'], {
            encoding: 'utf8',
          }).trim();
  } catch (err) {
    throw new Error(
      `Could not get a gcloud access token. Run "gcloud auth login" first.\n${err}`,
    );
  }
  if (!cachedToken) throw new Error('gcloud returned an empty access token');
  return cachedToken;
}

/* --------------------------------------------------- value encoding ---- */

export function encodeValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') {
    return Number.isInteger(value)
      ? { integerValue: String(value) }
      : { doubleValue: value };
  }
  if (Array.isArray(value)) {
    return { arrayValue: { values: value.map(encodeValue) } };
  }
  if (typeof value === 'object') {
    return { mapValue: { fields: encodeFields(value) } };
  }
  throw new Error(`cannot encode ${typeof value}`);
}

export function encodeFields(obj) {
  return Object.fromEntries(
    Object.entries(obj).map(([key, value]) => [key, encodeValue(value)]),
  );
}

export function decodeValue(value) {
  if (!value || typeof value !== 'object') return null;
  if ('nullValue' in value) return null;
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('integerValue' in value) return Number(value.integerValue);
  if ('doubleValue' in value) return value.doubleValue;
  if ('timestampValue' in value) return new Date(value.timestampValue);
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decodeValue);
  if ('mapValue' in value) return decodeFields(value.mapValue.fields ?? {});
  return null;
}

export function decodeFields(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [key, decodeValue(value)]),
  );
}

/* ---------------------------------------------------------- operations - */

async function request(method, path, body, query = '') {
  const response = await fetch(`${BASE}${path}${query}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}\n${text}`);
  }
  return text ? JSON.parse(text) : {};
}

export async function getDocument(path) {
  try {
    const doc = await request('GET', `/${path}`);
    return { id: doc.name.split('/').pop(), ...decodeFields(doc.fields ?? {}) };
  } catch (err) {
    if (String(err).includes('→ 404')) return null;
    throw err;
  }
}

export async function listDocuments(collection) {
  const out = [];
  let pageToken = '';
  do {
    const query = `?pageSize=300${pageToken ? `&pageToken=${pageToken}` : ''}`;
    const page = await request('GET', `/${collection}`, undefined, query);
    for (const doc of page.documents ?? []) {
      out.push({ id: doc.name.split('/').pop(), ...decodeFields(doc.fields ?? {}) });
    }
    pageToken = page.nextPageToken ?? '';
  } while (pageToken);
  return out;
}

/** Creates a document, failing if the id is already taken. */
export async function createDocument(collection, id, data) {
  return request(
    'POST',
    `/${collection}`,
    { fields: encodeFields(data) },
    `?documentId=${encodeURIComponent(id)}`,
  );
}

/** Creates or replaces a document at an exact path. */
export async function setDocument(path, data) {
  const mask = Object.keys(data)
    .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
    .join('&');
  return request('PATCH', `/${path}`, { fields: encodeFields(data) }, `?${mask}`);
}

export async function deleteDocument(path) {
  return request('DELETE', `/${path}`);
}
