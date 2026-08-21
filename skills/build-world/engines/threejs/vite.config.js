import { defineConfig } from 'vite';

export default defineConfig({
  // The example game lives in example/. Point this at your own game's directory.
  root: 'example',
  server: {
    // Bind IPv4 explicitly: vite's default `localhost` resolves to ::1 only on
    // some platforms, and the capture harness connects to 127.0.0.1.
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // KIT_NO_HMR=1 is set by tools/lib/harness.mjs when it owns the server. A
    // file saved by a concurrently-working agent otherwise reloads the page
    // mid-capture and playwright fails with "Execution context was destroyed" —
    // which looks like a harness bug and is not one.
    hmr: process.env.KIT_NO_HMR ? false : undefined,
    fs: { allow: ['..'] }, // example/ imports ../lib
  },
  preview: { host: '127.0.0.1' },
  build: { target: 'es2022', sourcemap: true, chunkSizeWarningLimit: 4096 },
});
