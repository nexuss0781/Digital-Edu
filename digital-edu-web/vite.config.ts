import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: Number(process.env.VITE_PORT) || 5198,
    proxy: {
      '/admin/api': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:5199',
        changeOrigin: true,
      },
      '/api': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:5199',
        changeOrigin: true,
      },
      '/static': {
        target: process.env.VITE_API_PROXY || 'http://127.0.0.1:5199',
        changeOrigin: true,
      },
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-mermaid': ['mermaid'],
          'vendor-markdown': [
            'react-markdown',
            'remark-gfm',
            'remark-frontmatter',
            'rehype-slug',
            'rehype-autolink-headings',
          ],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
});
