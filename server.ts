import 'dotenv/config';
import express from 'express';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';
import tokenHandler from './api/token.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const httpServer = http.createServer(app);
  const PORT = 3000;

  app.use(express.json());

  // Mount Vercel serverless handler at /api/token so it works identically in local/preview & Vercel
  app.all('/api/token', async (req, res) => {
    await tokenHandler(req, res);
  });

  if (process.env.NODE_ENV !== 'production') {
    const vitePromise = import('vite').then(({ createServer: createViteServer }) =>
      createViteServer({
        server: {
          middlewareMode: true,
          hmr: false,
          watch: process.env.DISABLE_HMR === 'true' ? null : {},
        },
        appType: 'spa',
      })
    );

    app.use(async (req, res, next) => {
      try {
        const vite = await vitePromise;
        vite.middlewares(req, res, next);
      } catch (err) {
        next(err);
      }
    });
  } else {
    const distPath = path.join(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  // Start listening on port 3000 immediately so cold-start health checks succeed right away
  httpServer.listen(PORT, '0.0.0.0', () => {
    console.log(`[TACTICAL VIDCOMM DISKOMLEKAU] Server active on http://0.0.0.0:${PORT}`);
  });
}

startServer();
