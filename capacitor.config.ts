import { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.rabbitfarm.manager',
  appName: '澳威兔场日程管理',
  webDir: 'dist',
  server: {
    androidScheme: 'https'
  }
};

export default config;
