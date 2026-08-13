import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8')
);

// Tauri 期望前端在 1420 端口
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  // Tauri 不支持相对路径，需要相对根
  base: '/',
  server: {
    port: 1420,
    host: '0.0.0.0',
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/ws': {
        target: 'ws://localhost:3000',
        ws: true
      }
    }
  },
  build: {
    // 兼容旧 Android WebView（Chrome < 71）：esbuild 会把 ?. / ?? 等 ES2020 语法
    // 降级为 ES5 兼容写法，避免旧 WebView 解析报白屏。桌面端 WebView2/WKWebView
    // 远高于此版本，降级无副作用。
    target: 'chrome70',
    minify: !process.env.TAURI_DEBUG ? 'esbuild' : false,
    sourcemap: !!process.env.TAURI_DEBUG
  }
});
