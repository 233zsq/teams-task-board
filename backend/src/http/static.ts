import fs from 'node:fs';
import path from 'node:path';
import express, { type Express } from 'express';

export interface StaticSpaOptions {
  directory: string;
}

/**
 * Build-demo entry: one Express process serves the frontend build and the API.
 * The SPA fallback only answers page navigation — unknown `/api` paths keep
 * their JSON 404 and never receive HTML.
 */
export function serveFrontendBuild(app: Express, options: StaticSpaOptions): void {
  const indexFile = path.join(options.directory, 'index.html');
  const ready = fs.existsSync(indexFile);

  app.use(
    express.static(options.directory, {
      index: false,
      setHeaders(res, filePath) {
        if (filePath.endsWith('index.html')) {
          res.setHeader('Cache-Control', 'no-store');
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      next();
      return;
    }
    if (/^\/api(\/|$)/.test(req.path)) {
      next();
      return;
    }
    if (!ready) {
      next();
      return;
    }

    res.setHeader('Cache-Control', 'no-store');
    // Keep the trusted checkout path in root: sendFile's dotfile checks apply
    // to the requested file, even if the checkout lives under .codex/.artifacts.
    res.sendFile('index.html', { root: options.directory });
  });
}
