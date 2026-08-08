import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.nobogent.app',
  appName: 'Nobogent AI',
  webDir: 'public',
  server: {
    // If CAPACITOR_SERVER_URL is set (e.g. http://10.0.2.2:3000 for Android emulator dev), use it.
    // Otherwise default to standard production app URL.
    url: process.env.CAPACITOR_SERVER_URL || 'https://app.nobogent.com',
    cleartext: true,
    androidScheme: 'https',
    iosScheme: 'https',
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
