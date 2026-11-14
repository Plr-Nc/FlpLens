import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Relative base so a built dist can be opened straight from disk (file://).
  base: './',
  build: { target: 'es2022', outDir: 'dist' },
});
