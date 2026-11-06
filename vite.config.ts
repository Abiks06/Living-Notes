import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** Everything outside dist/assets that offline start needs. Never add public/audio here. */
const SHELL = [
  '/',
  '/favicon.svg',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/icon-maskable-512.png',
];

/**
 * Writes dist/sw.js from src/pwa/sw.js with this build's file list. Any change to the site
 * changes that file, which is how browsers learn there's a new version.
 */
function serviceWorker(): Plugin {
  return {
    name: 'resonance-service-worker',
    apply: 'build',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle)
        .filter((name) => name.startsWith('assets/'))
        .sort()
        .map((name) => `/${name}`);
      const page = bundle['index.html'];
      const hash = createHash('sha256')
        .update(files.join())
        .update(page?.type === 'asset' ? page.source : '');
      for (const path of SHELL) if (path !== '/') hash.update(readFileSync(`public${path}`));
      const version = hash.digest('hex').slice(0, 12);
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: readFileSync('src/pwa/sw.js', 'utf8')
          .replace('__VERSION__', version)
          .replace('__FILES__', JSON.stringify([...SHELL, ...files])),
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), serviceWorker()],
  build: {
    target: 'es2022',
    // three.js alone is ~700 kB minified; it gets its own long-cached chunk below.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
      // @react-three/postprocessing imports these for effects this app never uses, and they
      // don't declare themselves free of side effects, so they'd ship otherwise.
      treeshake: {
        moduleSideEffects: [{ test: /node_modules[\\/](n8ao|maath)[\\/]/, sideEffects: false }],
      },
      output: {
        // Vendor chunks change far less often than app code, so returning visitors
        // re-download only the small app chunk after a deploy.
        codeSplitting: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]/, priority: 3 },
            {
              name: 'r3f',
              test: /node_modules[\\/](@react-three|postprocessing|three-stdlib|camera-controls|maath|n8ao)[\\/]/,
              priority: 2,
            },
            {
              name: 'react',
              test: /node_modules[\\/](react|react-dom|scheduler|zustand)[\\/]/,
              priority: 1,
            },
          ],
        },
      },
    },
  },
});
