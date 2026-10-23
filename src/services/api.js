/* Thin client for the FloodSense API (server/main.py).
   REACT_APP_API_URL is the API origin, baked in at build time from .env.production.
   Left empty (.env), paths stay relative: in development package.json "proxy"
   forwards /api to the local server. */

const API_URL = (process.env.REACT_APP_API_URL || '').replace(/\/+$/, '');

async function request(method, path, body) {
  const res = await fetch(API_URL + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (e) { /* not JSON */ }
    throw new Error(typeof detail === 'string' ? detail : JSON.stringify(detail));
  }
  return res.json();
}

export const api = {
  get: (path) => request('GET', path),
  post: (path, body) => request('POST', path, body || {}),
  patch: (path, body) => request('PATCH', path, body),
  del: (path) => request('DELETE', path),
};

/** Read a File as base64 (without the data: prefix). */
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(',')[1]);
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

/** Fetch an image URL (e.g. a sample frame) as base64. */
export async function urlToBase64(url) {
  const blob = await (await fetch(url)).blob();
  return fileToBase64(blob);
}
