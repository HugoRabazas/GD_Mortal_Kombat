// Builds the whole game into ONE self-contained page: dist/gd-arena.html.
//
// That file is what gets published as the Artifact. It follows the Artifact
// page format: no <html>/<head>/<body> tags of its own (the host adds them),
// all of our code, styles and pictures inlined, and only the 3D library and
// the fonts loaded from the two hosts an Artifact is allowed to use.
//
// It also writes dist/index.html, the same page wrapped in a normal HTML
// skeleton, so the build can be opened and tested in any browser.

import { build } from 'vite';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const THREE_URL = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
const FONTS_URL = 'https://fonts.googleapis.com/css2?family=Teko:wght@500;700&family=Barlow:wght@400;600;700&display=swap';

// `node scripts/build.js` builds the Artifact page (offline modes only).
// `node scripts/build.js web` builds the website with online play; it reads
// where the lobby lives from the environment:
//   GD_SUPABASE_URL  the Supabase project address
//   GD_SUPABASE_KEY  its publishable key (public by design, safe in a web page)
const web = process.argv[2] === 'web';
const net = web && process.env.GD_SUPABASE_URL && process.env.GD_SUPABASE_KEY ? { url: process.env.GD_SUPABASE_URL, key: process.env.GD_SUPABASE_KEY } : null;
if (web && !net) console.warn('GD_SUPABASE_URL / GD_SUPABASE_KEY not set: building the website without online play.');

const result = await build({
  configFile: false,
  root: path.join(root, 'client'),
  logLevel: 'warn',
  // __BUILD__ changes with every build, so online players can tell whether
  // they are all running the same version.
  define: { __NET__: JSON.stringify(net), __BUILD__: JSON.stringify(Date.now().toString(36)) },
  // The Artifact page cannot reach the network, so it leaves the online
  // library out altogether.
  resolve: web ? {} : { alias: { '@supabase/supabase-js': path.join(root, 'scripts', 'no-online.js') } },
  build: {
    write: false,
    target: 'es2020',
    minify: true,
    lib: { entry: 'src/main.js', formats: ['iife'], name: 'GDArena' },
  },
});

const output = (Array.isArray(result) ? result[0] : result).output;
const js = output.find((o) => o.type === 'chunk').code.replace(/<\/script/gi, '<\\/script');
const css = readFileSync(path.join(root, 'client', 'src', 'style.css'), 'utf8');

const page = `<title>GD Arena</title>
<meta name="claude:viewport-fit-sides" content="cover">
<link rel="stylesheet" href="${FONTS_URL}">
<style>
${css}</style>
<div id="app"></div>
<script src="${THREE_URL}"></script>
<script>
${js}
</script>
`;

const preview = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>
:root { color-scheme: light; padding: env(safe-area-inset-top, 0px) 0 env(safe-area-inset-bottom, 0px); box-sizing: border-box; }
body { margin: 0; font: 14px system-ui, sans-serif; }
img { max-width: 100%; }
[hidden] { display: none !important; }
</style>
</head>
<body>
${page}</body>
</html>
`;

if (web) {
  mkdirSync(path.join(root, 'dist-web'), { recursive: true });
  writeFileSync(path.join(root, 'dist-web', 'index.html'), preview.replace('<head>', '<head>\n<meta name="description" content="GD Arena: a 3D arena fighting game for the alliance, playable online.">'));
  console.log(`dist-web/index.html  ${(preview.length / 1024).toFixed(0)} KB  online: ${net ? 'yes' : 'no'}`);
} else {
  mkdirSync(path.join(root, 'dist'), { recursive: true });
  writeFileSync(path.join(root, 'dist', 'gd-arena.html'), page);
  writeFileSync(path.join(root, 'dist', 'index.html'), preview);
  console.log(`dist/gd-arena.html  ${(page.length / 1024).toFixed(0)} KB`);
}
