/** Path the app is served from: '' at a domain root, '/chat' under a sub-path (set via BASE_PATH at build). */
export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');

export const asset = (path) => `${BASE}/${path.replace(/^\//, '')}`;
