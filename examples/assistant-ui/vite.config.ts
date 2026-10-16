import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  // assistant-ui, React and the kit in one chunk: fine for an example.
  build: { chunkSizeWarningLimit: 1000 },
});
