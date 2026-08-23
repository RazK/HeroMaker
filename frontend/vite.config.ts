import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Load env vars - loadEnv only reads from .env files, so also check process.env for Docker
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env }
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8000'
  
  return {
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      devOptions: {
        enabled: true,
        type: 'module'
      },
      includeAssets: ['logo-head-64.png', 'logo-head-192.png'],
      manifest: {
        name: 'HeroMaker',
        short_name: 'HeroMaker',
        description: 'Create and manage your hero creations',
        theme_color: '#ffffff',
        background_color: '#ffffff',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          {
            src: 'logo-head-192.png',
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'logo-head-512.png',
            sizes: '512x512',
            type: 'image/png'
          },
          {
            src: 'logo-head-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable'
          }
        ]
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,svg,woff2}', 'logo-head-{64,192}.png'],
        // Keep the precache to the app shell. The three.js chunk is ~800 kB and is
        // only needed once a 3D view opens, so it is excluded here and cached at
        // runtime instead (see the three-chunk rule below). Same idea for images:
        // a first-time visitor should not be pushed assets they may never look at.
        globIgnores: ['**/ModelPreview-*.js'],
        maximumFileSizeToCacheInBytes: 400 * 1024,
        runtimeCaching: [
          {
            // The 3D chunk (three.js + the model preview). Fetched the first time a
            // model preview mounts, then served from cache on every later visit.
            urlPattern: /\/assets\/ModelPreview-[\w-]+\.js$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'model-preview-chunk-cache',
              expiration: {
                maxEntries: 4,
                maxAgeSeconds: 60 * 60 * 24 * 30 // 30 days
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.googleapis\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'google-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
            handler: 'CacheFirst',
            options: {
              cacheName: 'gstatic-fonts-cache',
              expiration: {
                maxEntries: 10,
                maxAgeSeconds: 60 * 60 * 24 * 365 // 1 year
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          },
          {
            urlPattern: /^\/api\/.*/i,
            handler: 'NetworkFirst',
            options: {
              cacheName: 'api-cache',
              expiration: {
                maxEntries: 50,
                maxAgeSeconds: 60 * 5 // 5 minutes
              },
              cacheableResponse: {
                statuses: [0, 200]
              }
            }
          }
        ]
      }
    })
  ],
  // Build configuration for production
  build: {
    outDir: 'dist',
    sourcemap: false,
    // Ensure proper chunking for better caching
    rollupOptions: {
      output: {
        manualChunks: {
          vendor: ['react', 'react-dom'],
          // three.js is deliberately NOT listed here. Naming it as a manual chunk
          // makes Vite treat it as part of the entry graph and emit a
          // <link rel="modulepreload"> for it, which pulls all ~800 kB on first
          // paint and defeats the lazy import in LazyModelPreview.
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


