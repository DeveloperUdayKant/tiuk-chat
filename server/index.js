import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { Server } from 'socket.io';
import { config } from './config.js';
import { initDb } from './db.js';
import { requireAuth, csrfGuard } from './auth.js';
import { attachRealtime } from './realtime.js';
import { errorHandler } from './lib/http.js';
import authRoutes from './routes/auth.js';
import userRoutes from './routes/users.js';
import conversationRoutes from './routes/conversations.js';
import fileRoutes, { sweepOrphanFiles } from './routes/files.js';

await initDb();
await fs.promises.mkdir(config.uploadDir, { recursive: true });

const app = express();
if (config.isProd) app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({
  contentSecurityPolicy: config.isProd && {
    useDefaults: true,
    directives: {
      'script-src': ["'self'"],
      'style-src': ["'self'", "'unsafe-inline'"],
      'img-src': ["'self'", 'blob:', 'data:'],
      'media-src': ["'self'", 'blob:'],
      'font-src': ["'self'", 'data:'],
      'connect-src': ["'self'"],
      'frame-ancestors': ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(cookieParser());
app.use(express.json({ limit: '2mb' }));

const api = express.Router();
api.use(csrfGuard);
api.get('/config', (_req, res) => res.json({
  maxFileBytes: config.maxFileBytes,
  maxFilesPerMessage: config.maxFilesPerMessage,
  kdfIterations: config.kdfIterations,
}));
api.use('/auth', authRoutes);
api.use('/users', requireAuth, userRoutes);
api.use('/conversations', requireAuth, conversationRoutes);
api.use('/files', requireAuth, fileRoutes);
api.use((_req, res) => res.status(404).json({ error: 'not_found', message: 'Not found.' }));
app.use('/api', api);

// In production the built client is served by this same process.
const dist = path.join(config.root, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist, { index: false, maxAge: '1h' }));
  app.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use(errorHandler);

const server = http.createServer(app);

// Hosted under a sub-path (e.g. /chat)? Strip the prefix before Express and Socket.IO see the URL.
// Some proxies (cPanel/Passenger) already strip it and some don't, so accept both forms.
if (config.basePath) {
  const base = config.basePath;
  const emit = server.emit.bind(server);
  server.emit = (event, req, ...args) => {
    if ((event === 'request' || event === 'upgrade') && typeof req?.url === 'string'
      && (req.url === base || req.url.startsWith(`${base}/`) || req.url.startsWith(`${base}?`))) {
      const rest = req.url.slice(base.length);
      req.url = rest.startsWith('/') ? rest : `/${rest}`;
    }
    return emit(event, req, ...args);
  };
}

attachRealtime(new Server(server, { serveClient: false }));

setInterval(() => sweepOrphanFiles().catch((e) => console.error('sweep failed', e)), 60 * 60 * 1000).unref();

server.listen(config.port, () => {
  console.log(`TIUK Chat API listening on http://localhost:${config.port}`);
});
