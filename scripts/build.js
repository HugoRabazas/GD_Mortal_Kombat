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

const result = await build({
  configFile: false,
  root: path.join(root, 'client'),
  logLevel: 'warn',
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

mkdirSync(path.join(root, 'dist'), { recursive: true });
writeFileSync(path.join(root, 'dist', 'gd-arena.html'), page);
writeFileSync(path.join(root, 'dist', 'index.html'), preview);
console.log(`dist/gd-arena.html  ${(page.length / 1024).toFixed(0)} KB`);
