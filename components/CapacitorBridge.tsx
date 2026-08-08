'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Capacitor } from '@capacitor/core';

export function CapacitorBridge() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) {
      return;
    }

    let backButtonListener: any = null;

    const setupNativeListeners = async () => {
      try {
        // Dynamically import plugins to avoid SSR issues
        const { App } = await import('@capacitor/app');
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        const { SplashScreen } = await import('@capacitor/splash-screen');

        // Hide splash screen once bridge is ready
        await SplashScreen.hide().catch(() => {});

        // Configure Status Bar style
        await StatusBar.setStyle({ style: Style.Dark }).catch(() => {});

        // Handle Android Hardware Back Button
        backButtonListener = await App.addListener('backButton', (state) => {
          const rootPaths = ['/dashboard', '/login', '/'];
          if (rootPaths.includes(pathname) || !state.canGoBack) {
            App.minimizeApp();
          } else {
            router.back();
          }
        });
      } catch (err) {
        console.warn('[CapacitorBridge] Plugin setup warning:', err);
      }
    };

    setupNativeListeners();

    return () => {
      if (backButtonListener && typeof backButtonListener.remove === 'function') {
        backButtonListener.remove();
      }
    };
  }, [router, pathname]);

  return null;
}
