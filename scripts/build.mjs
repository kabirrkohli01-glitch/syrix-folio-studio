// Builds the main process, preload and renderer bundles into dist/.
//   node scripts/build.mjs           one-off production build
//   node scripts/build.mjs --watch   rebuild on change

import * as esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const watch = process.argv.includes('--watch');
const dist = path.join(root, 'dist');

fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(path.join(dist, 'renderer'), { recursive: true });
fs.mkdirSync(path.join(dist, 'main'), { recursive: true });

const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const runtimeDeps = Object.keys(pkg.dependencies || {});

const builds = [
  {
    entryPoints: [path.join(root, 'src/main/main.js')],
    outfile: path.join(dist, 'main/main.js'),
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    external: ['electron', ...runtimeDeps],
    sourcemap: 'linked',
    logLevel: 'warning',
  },
  {
    entryPoints: [path.join(root, 'src/main/preload.cjs')],
    outfile: path.join(dist, 'main/preload.cjs'),
    bundle: false,
    platform: 'node',
    format: 'cjs',
    logLevel: 'warning',
  },
  {
    entryPoints: [path.join(root, 'src/renderer/index.jsx')],
    outfile: path.join(dist, 'renderer/app.js'),
    bundle: true,
    platform: 'browser',
    format: 'iife',
    target: 'chrome130',
    jsx: 'automatic',
    loader: { '.woff2': 'file', '.woff': 'file', '.png': 'file', '.svg': 'file' },
    assetNames: 'assets/[name]-[hash]',
    minify: !watch,
    sourcemap: watch ? 'inline' : false,
    define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' },
    legalComments: 'none',
    logLevel: 'warning',
  },
];

fs.copyFileSync(path.join(root, 'src/renderer/index.html'), path.join(dist, 'renderer/index.html'));

if (watch) {
  for (const b of builds) {
    const ctx = await esbuild.context(b);
    await ctx.watch();
  }
  console.log('Watching for changes…');
} else {
  const t0 = Date.now();
  await Promise.all(builds.map((b) => esbuild.build(b)));
  console.log(`Built in ${Date.now() - t0} ms`);
}
