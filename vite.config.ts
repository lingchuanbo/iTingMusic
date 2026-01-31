import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src')
    }
  },
  server: {
    proxy: {
      '/api': {
        target: 'https://tunehub.sayqz.com',
        changeOrigin: true,
        secure: false
      },
      '/gdapi': {
        target: 'https://music-api.gdstudio.xyz',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/gdapi/, '')
      },
      // 音乐平台代理 (解决 CORS)
      '/proxy-netease': {
        target: 'https://music.163.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/proxy-netease/, '')
      },
      '/proxy-qq': {
        target: 'https://u.y.qq.com',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/proxy-qq/, '')
      },
      '/proxy-kuwo': {
        target: 'https://www.kuwo.cn',
        changeOrigin: true,
        secure: false,
        rewrite: (path) => path.replace(/^\/proxy-kuwo/, '')
      }
    }
  }
})
