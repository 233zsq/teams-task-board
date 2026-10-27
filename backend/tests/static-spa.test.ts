import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import request from 'supertest';
import { afterEach, describe, expect, it } from 'vitest';
import { apiNotFound } from '../src/http/middleware/not-found';
import { serveFrontendBuild } from '../src/http/static';

const directories: string[] = [];
afterEach(() => {
  const tempRoot = fs.realpathSync(os.tmpdir());
  for (const directory of directories.splice(0)) {
    if (path.dirname(directory) !== tempRoot || !path.basename(directory).startsWith('team-plan-static-')) {
      throw new Error('Unexpected temporary static directory');
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe('built frontend SPA navigation', () => {
  it.each(['normal-checkout', '.hidden-checkout'])('serves deep links under %s', async (checkout) => {
    const temporary = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'team-plan-static-'));
    directories.push(temporary);
    const directory = path.join(temporary, checkout, 'frontend', 'dist');
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, 'index.html'), '<!doctype html><div id="app">SPA fixture</div>');
    fs.writeFileSync(path.join(directory, 'app.js'), 'console.log("fixture")');
    // Dotfiles in the public directory remain private even when the checkout's
    // own path contains a dot-directory (e.g. .codex or .artifacts).
    fs.writeFileSync(path.join(directory, '.private'), 'private fixture');
    const app = express();
    app.use('/api', apiNotFound());
    serveFrontendBuild(app, { directory });

    const navigation = await request(app).get('/boards/fixture-board');
    expect(navigation.status).toBe(200);
    expect(navigation.text).toContain('SPA fixture');
    expect(navigation.headers['cache-control']).toBe('no-store');
    const asset = await request(app).get('/app.js');
    expect(asset.status).toBe(200);
    const unknownApi = await request(app).get('/api/v1/unknown');
    expect(unknownApi.status).toBe(404);
    expect(unknownApi.headers['content-type']).toMatch(/json/);
    const privateFile = await request(app).get('/.private');
    expect(privateFile.text).not.toContain('private fixture');
    expect((await request(app).post('/boards/fixture-board')).status).toBe(404);
  });
});
