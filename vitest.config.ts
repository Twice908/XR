import { defineConfig } from 'vite'

export default defineConfig({
  resolve: {
    dedupe: ['three'],
  },
  optimizeDeps: {
    include: ['three', 'three/examples/jsm/loaders/GLTFLoader.js'],
  },
  server: {
    port: 5173,
    host: true,
  },
})