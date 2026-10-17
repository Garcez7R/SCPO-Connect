import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api/v1/auth': 'http://127.0.0.1:8002',
      '/api/v1/access': 'http://127.0.0.1:8002',
      '/api/v1/audit': 'http://127.0.0.1:8006',
      '/api/v1/nursing': 'http://127.0.0.1:8001',
      '/api/v1/reception': 'http://127.0.0.1:8001',
      '/api/v1/pharmacy': 'http://127.0.0.1:8003',
      '/api/v1/social': 'http://127.0.0.1:8005',
      '/api/v1/xray': 'http://127.0.0.1:8004',
      '/api/v1/maintenance': 'http://127.0.0.1:8007',
      '/api/v1/hygiene': 'http://127.0.0.1:8007',
    },
  },
})
