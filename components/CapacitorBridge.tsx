'use client';

import { useEffect } from 'react';
import { useRouter, usePathname } from 'next/navigation';

export function CapacitorBridge() {
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    let backButtonListener: any = null;

    const setupNativeListeners = async () => {
      try {
        const { Capacitor } = await import('@capacitor/core');
        if (!Capacitor.isNativePlatform()) {
          return;
        }
        // Dynamically import plugins to avoid SSR issues
        const { App } = await import('@capacitor/app');
        const { StatusBar, Style } = await import('@capacitor/status-bar');
        const { SplashScreen } = await import('@capacitor/splash-screen');

        // Hide splash screen once bridge is ready
        await SplashScreen.hide().catch(() => {});

        // Hide splash screen when app resumes from background (e.g. after phone call)
        await App.addListener('appStateChange', ({ isActive }) => {
          if (isActive) {
            SplashScreen.hide().catch(() => {});
          }
        });

        // Push Notifications on Native Platform
        try {
          const { PushNotifications } = await import('@capacitor/push-notifications');

          if (Capacitor.getPlatform() === 'android') {
            await PushNotifications.createChannel({
              id: 'nobogent_notifications',
              name: 'Nobogent Alerts',
              description: 'Real-time alerts for incoming leads, calls, and campaigns',
              importance: 5,
              visibility: 1,
              vibration: true,
              sound: 'default'
            }).catch(() => {});
          }

          let perm = await PushNotifications.checkPermissions();
          if (perm.receive === 'prompt' || perm.receive === 'prompt-with-rationale') {
            perm = await PushNotifications.requestPermissions();
          }

          if (perm.receive === 'granted') {
            await PushNotifications.register();
          }

          PushNotifications.addListener('registration', async (token) => {
            console.log('[Native Push] Device Token registered:', token.value);
            try {
              await fetch('/api/web-push/subscribe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  fcmToken: token.value,
                  platform: Capacitor.getPlatform()
                })
              });
            } catch (syncErr) {
              console.warn('[Native Push] Auto-sync token error:', syncErr);
            }
          });

          PushNotifications.addListener('pushNotificationReceived', (notification) => {
            console.log('[Native Push] Notification received in foreground:', notification);
          });

          PushNotifications.addListener('pushNotificationActionPerformed', (action) => {
            const targetUrl = action.notification.data?.url;
            if (targetUrl) {
              router.push(targetUrl);
            }
          });
        } catch (pushErr) {
          console.warn('[CapacitorBridge] Push setup notice:', pushErr);
        }

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
