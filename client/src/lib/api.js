import { BASE } from './base.js';

export class ApiError extends Error {
  constructor(status, body) {
    super(body?.message || `Request failed (${status})`);
    this.status = status;
    this.code = body?.error || 'error';
    this.body = body;
  }
}

let onUnauthorized = () => {};
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn; };

async function request(method, url, body, { raw = false, signal, onProgress } = {}) {
  const headers = { 'X-Tiuk-Client': '1' };
  let payload;
  if (body instanceof Blob || body instanceof ArrayBuffer || ArrayBuffer.isView(body)) {
    headers['Content-Type'] = 'application/octet-stream';
    payload = body;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  if (onProgress && payload) return xhrUpload(method, url, headers, payload, onProgress, signal);

  const res = await fetch(`${BASE}/api${url}`, { method, headers, body: payload, credentials: 'same-origin', signal });
  if (raw && res.ok) return res;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (res.status === 401 && !url.startsWith('/auth/')) onUnauthorized();
    throw new ApiError(res.status, data);
  }
  return data;
}

/** fetch() has no upload progress, so encrypted file uploads go through XHR. */
function xhrUpload(method, url, headers, payload, onProgress, signal) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(method, `${BASE}/api${url}`);
    Object.entries(headers).forEach(([k, v]) => xhr.setRequestHeader(k, v));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onload = () => {
      let data = {};
      try { data = JSON.parse(xhr.responseText); } catch { /* empty */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data));
    };
    xhr.onerror = () => reject(new ApiError(0, { message: 'Network error during upload.' }));
    xhr.onabort = () => reject(new ApiError(0, { error: 'aborted', message: 'Upload cancelled.' }));
    signal?.addEventListener('abort', () => xhr.abort());
    xhr.send(payload);
  });
}

export const api = {
  get: (url, opts) => request('GET', url, undefined, opts),
  post: (url, body, opts) => request('POST', url, body, opts),
  patch: (url, body) => request('PATCH', url, body),
  del: (url) => request('DELETE', url),
};
