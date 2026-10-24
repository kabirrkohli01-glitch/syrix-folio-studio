// Shared launcher for end-to-end tests: starts the built app with an isolated
// data folder and collects renderer console errors.
import { _electron as electron } from 'playwright';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export async function launch({ userData, env = {} } = {}) {
  const dir = userData || fs.mkdtempSync(path.join(os.tmpdir(), 'folio-e2e-'));
  const app = await electron.launch({
    args: [ROOT],
    env: { ...process.env, FOLIO_USER_DATA: dir, ...env },
  });
  const page = await app.firstWindow();
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.waitForSelector('.sidebar', { timeout: 20000 });
  return { app, page, errors, dir };
}
