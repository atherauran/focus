import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// Dev only: the offline renderer (render.html) posts WAV/JSON files here for analysis.
const renderSink = (): Plugin => ({
  name: 'render-sink',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__render', (req, res) => {
      const name = new URL(req.url ?? '', 'http://x').searchParams.get('name') ?? 'render';
      const chunks: Buffer[] = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const dir = resolve(__dirname, 'renders');
        mkdirSync(dir, { recursive: true });
        writeFileSync(resolve(dir, name.replace(/[^\w.-]/g, '_')), Buffer.concat(chunks));
        res.end('ok');
      });
    });
  },
});

export default defineConfig({
  base: './',
  plugins: [react(), renderSink()],
  build: {
    rollupOptions: { input: { main: resolve(__dirname, 'index.html') } },
  },
});
