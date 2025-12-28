import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env vars - loadEnv only reads from .env files, so also check process.env for Docker
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'
  
  return {
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
    port: parseInt(env.VITE_DEV_PORT || process.env.VITE_DEV_PORT || '5173'), // Use env var or default to 5173
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
      clientPort: 5173,
    },
    proxy: {
      '/api': {
        // Use VITE_API_PROXY_TARGET from env (for Docker), otherwise default to localhost
        target: apiProxyTarget,
        changeOrigin: true,
        secure: false,
        followRedirects: true,
      },
    },
  }
  // Note: In production (Docker), nginx handles API proxying
  // The proxy above is only for local development with `npm run dev`
  }
})


