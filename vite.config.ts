/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { apiLocal } from './server/plugin.ts';

export default defineConfig({
  plugins: [apiLocal()],
  server: { port: 5173 },
  test: { environment: 'node', testTimeout: 60000 },
});
