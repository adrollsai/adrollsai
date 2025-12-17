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
  serverExternalPackages: ['@supabase/supabase-js', 'sharp'],

  experimental: {
    // @ts-expect-error - This property is valid at runtime but missing from strict NextConfig types
    outputFileTracingIncludes: {
      '/api/**/*': ['./fonts/**/*'],
    },
  },

  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: "pub-c9b2fd77f9484acab7c67cf5c62e7d37.r2.dev", 
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default pwa(nextConfig);