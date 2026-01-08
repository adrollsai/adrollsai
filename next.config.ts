import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const pwa = withPWA({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === "development",
  workboxOptions: {
    disableDevLogs: true,
    skipWaiting: true,
    clientsClaim: true,
  },
});

const nextConfig: NextConfig = {
  // Reduces memory usage on Vercel
  serverExternalPackages: ['@supabase/supabase-js', 'sharp'],

  images: {
    // CRITICAL: Unoptimized = True prevents Vercel from processing R2 images
    // preventing the 1000 image limit and timeout errors.
    unoptimized: true, 
    remotePatterns: [
      {
        protocol: 'https',
        hostname: "pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev", 
        port: '',
        pathname: '/**',
      },
    ],
  },

  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "script-src 'self' 'unsafe-eval' 'unsafe-inline' https: http:;", 
          },
        ],
      },
    ];
  },
};

export default pwa(nextConfig);