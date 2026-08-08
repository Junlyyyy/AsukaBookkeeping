import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.asuka.bookkeeping',
  appName: 'Asuka记账',
  webDir: 'dist',
  android: {
    allowMixedContent: true,
  },
  server: {
    androidScheme: 'https',
    // APK 场景使用本地数据层，无需连接远端；保留默认以兼容本地调试
  },
};

export default config;
