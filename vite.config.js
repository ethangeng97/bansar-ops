import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          // 三方依赖独立 chunk（缓存命中率高）
          if (id.includes('node_modules')) {
            if (id.includes('react')) return 'vendor-react';
            if (id.includes('@supabase')) return 'vendor-supabase';
            if (id.includes('/xlsx/')) return 'vendor-xlsx';
            return 'vendor';
          }
          // 业务页面分包（每个模块独立 chunk）
          if (id.includes('/pages/Orders')) return 'page-orders';
          if (id.includes('/pages/Partners')) return 'page-partners';
          if (id.includes('/pages/Portal')) return 'page-portal';
        },
      },
    },
    chunkSizeWarningLimit: 500,
  },
})
