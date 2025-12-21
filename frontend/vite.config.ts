import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Build configuration for production
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Ensure proper chunking for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          three: ['three', '@react-three/fiber', '@react-three/drei'],
        },
      },
    },
  },
  // Development server configuration (only used in local dev, not in Docker)
  server: {
    host: '0.0.0.0', // Listen on all network interfaces
    port: 3000,
    // Allow connections from these hosts (for mobile access)
    allowedHosts: [
      'localhost',
      '127.0.0.1',
      '172.22.1.177',
      '10.134.182.151',
      '10.99.108.169',
      'Razs-MacBook-Pro.local',
      'razs-macbook-pro.local',
    ],
    // Disable HMR for network access (it won't work from mobile anyway)
    hmr: {
      host: 'localhost',
      clientPort: 3000,
    },
    proxy: {
      '/api': {
        target: process.env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000',
        changeOrigin: true,
        secure: false,
        followRedirects: true,
      },
    },
  },
  // Note: In production (Docker), nginx handles API proxying
  // The proxy above is only for local development with `npm run dev`
})


