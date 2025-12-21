import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
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
        target: 'http://127.0.0.1:8000',
        changeOrigin: false,
        secure: false,
      },
    },
  },
})


