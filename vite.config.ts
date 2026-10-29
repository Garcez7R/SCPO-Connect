import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
        nursing: fileURLToPath(new URL('./nursing.html', import.meta.url)),
        operations: fileURLToPath(new URL('./operations.html', import.meta.url)),
        pharmacy: fileURLToPath(new URL('./pharmacy.html', import.meta.url)),
      },
    },
  },
  server: {
    host: '127.0.0.1',
    proxy: {
      '/api/v1/auth': 'http://127.0.0.1:8002',
      '/api/v1/access': 'http://127.0.0.1:8002',
      '/api/v1/system-admin': 'http://127.0.0.1:8002',
      '/api/v1/audit': 'http://127.0.0.1:8006',
      '/api/v1/nursing': 'http://127.0.0.1:8001',
      '/api/v1/management': 'http://127.0.0.1:8001',
      '/api/v1/physicians': 'http://127.0.0.1:8001',
      '/api/v1/reception': 'http://127.0.0.1:8001',
      '/api/v1/pharmacy': 'http://127.0.0.1:8003',
      '/api/v1/social': 'http://127.0.0.1:8005',
      '/api/v1/interprofessional': 'http://127.0.0.1:8005',
      '/api/v1/psychology': 'http://127.0.0.1:8005',
      '/api/v1/xray': 'http://127.0.0.1:8004',
      '/api/v1/maintenance': 'http://127.0.0.1:8007',
      '/api/v1/hygiene': 'http://127.0.0.1:8007',
      '/api/v1/therapy': 'http://127.0.0.1:8008',
      '/api/v1/backup': 'http://127.0.0.1:8009',
    },
  },
})
