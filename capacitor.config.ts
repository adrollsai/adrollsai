import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nobogent.app',
  appName: 'Nobogent AI',
  webDir: 'public',
  server: {
    url: 'https://app.nobogent.com',
    allowNavigation: ['app.nobogent.com', '*.nobogent.com', 'nobogent.com'],
    cleartext: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 2000,
      launchAutoHide: true,
      launchFadeOutDuration: 500,
      backgroundColor: '#FFFFFF',
      androidSplashResourceName: 'splash',
      androidScaleType: 'CENTER',
      showSpinner: false,
    },
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#FFFFFF',
    },
    Keyboard: {
      resize: 'body',
      style: 'DARK',
      resizeOnFullScreen: true,
    },
  },
};

export default config;
