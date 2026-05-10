// adrollsai/adrollsai/adrollsai-adrollsai-version3/next.config.ts

import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const pwa = withPWA({
  dest: "public",
  register: false,
  disable: false, 
  workboxOptions: {
    disableDevLogs: true,
    skipWaiting: true,
    clientsClaim: true,
    importScripts: ['/custom-sw.js'],
  },
  sw: "/sw.js", // This ensures it uses the generated sw.js which we will link to custom-sw.js
});

const nextConfig: NextConfig = {
  serverExternalPackages: ['@supabase/supabase-js'],
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
};

export default pwa(nextConfig);