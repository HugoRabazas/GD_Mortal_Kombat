import { defineConfig } from 'vite';

// Used by `npm run dev` only: serves client/ with live reload.
// The published single-file page is produced by scripts/build.js.
export default defineConfig({
  root: 'client',
  server: { port: 5173, fs: { allow: ['..'] } },
});
