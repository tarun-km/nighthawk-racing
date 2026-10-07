import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Dev only: receives trailer frames posted by window.__nh.rec (src/main.js)
// and writes them to trailer/frames for ffmpeg (see scripts/trailer.sh).
function trailerFrames() {
  return {
    name: 'trailer-frames',
    apply: 'serve',
    configureServer(server) {
      const dir = path.resolve('trailer/frames');
      server.middlewares.use('/__frame', (req, res) => {
        if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
        const i = Number(new URL(req.url, 'http://x').searchParams.get('i'));
        if (!Number.isInteger(i) || i < 0) { res.statusCode = 400; res.end(); return; }
        fs.mkdirSync(dir, { recursive: true });
        const chunks = [];
        req.on('data', (c) => chunks.push(c));
        req.on('end', () => {
          fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, '0')}.jpg`), Buffer.concat(chunks));
          res.end('ok');
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [trailerFrames()],
  server: { port: 3000 },
  preview: { port: 3000 },
  build: {
    target: 'esnext',
    chunkSizeWarningLimit: 2500,
    rollupOptions: {
      output: {
        // the engine libraries change rarely: cache them separately from game code
        manualChunks: { three: ['three'], rapier: ['@dimforge/rapier3d-compat'], gsap: ['gsap'] },
      },
    },
  },
  optimizeDeps: { esbuildOptions: { target: 'esnext' } },
});
