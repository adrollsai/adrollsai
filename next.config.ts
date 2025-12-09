// adrollsai/adrollsai/adrollsai-adrollsai-version3/next.config.ts

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
  // MOVED: This is now a top-level option in Next.js 16+
  serverExternalPackages: ['@supabase/supabase-js'],
  
  experimental: {
    // Empty for now
  },
};

export default pwa(nextConfig);