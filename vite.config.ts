import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    target: 'es2022',
    // three.js alone is ~700 kB minified; it gets its own long-cached chunk below.
    chunkSizeWarningLimit: 800,
    rolldownOptions: {
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
