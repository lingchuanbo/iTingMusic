import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.iting.music',
  appName: 'iTingMusic',
  webDir: 'dist',
  server: {
    // 允许跨域请求
    allowNavigation: ['*'],
    cleartext: true
  },
  android: {
    // 允许混合内容和跨域
    allowMixedContent: true
  }
}

export default config
