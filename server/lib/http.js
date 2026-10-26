export class HttpError extends Error {
  constructor(status, code, message, extra) {
    super(message || code);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

export const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.code, message: err.message, ...err.extra });
  }
  if (err?.type === 'entity.too.large') {
    return res.status(413).json({ error: 'too_large', message: 'Payload is too large.' });
  }
  console.error(err);
  res.status(500).json({ error: 'server_error', message: 'Something went wrong.' });
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const B64_RE = /^[A-Za-z0-9+/]+={0,2}$/;

export const is = {
  uuid: (v) => typeof v === 'string' && UUID_RE.test(v),
  b64: (v, max = Infinity) => typeof v === 'string' && v.length > 0 && v.length <= max && B64_RE.test(v),
  str: (v, min, max) => typeof v === 'string' && v.trim().length >= min && v.trim().length <= max,
};

export function assert(cond, code = 'invalid_request', message = 'Invalid request.', status = 400) {
  if (!cond) throw new HttpError(status, code, message);
}
