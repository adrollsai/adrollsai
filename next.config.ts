// adrollsai/adrollsai/adrollsai-adrollsai-version3/next.config.ts

import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const pwa = withPWA({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === 'development', 
  workboxOptions: {
    disableDevLogs: true,
    skipWaiting: true,
    clientsClaim: true,
    importScripts: ['/custom-sw.js'],
  },
  sw: "/sw.js", // This ensures it uses the generated sw.js which we will link to custom-sw.js
});

const nextConfig: NextConfig = {
  typescript: {
    // Build-time type checking is now ON. It was previously disabled, which is how
    // runtime-fatal defects (a TDZ `ReferenceError` in the caption route, `.catch()` on
    // Supabase query builders in the voice/webhook paths, missing profile columns) reached
    // production silently. `npm run typecheck` is green, so a red build now means a real
    // regression rather than pre-existing noise.
    ignoreBuildErrors: false,
  },
  turbopack: {},
  serverExternalPackages: [
    '@supabase/supabase-js',
    '@remotion/lambda',
    '@remotion/renderer',
    '@remotion/bundler',
    '@remotion/cli',
    '@remotion/lambda-client',
    '@remotion/serverless-client',
    'ffmpeg-static'
  ],
  outputFileTracingIncludes: {
    '/api/**/*': ['./node_modules/ffmpeg-static/**/*', './public/**/*'],
  },
  images: {
    unoptimized: true,
  },
  async rewrites() {
    return [
      {
        source: '/experience',
        destination: '/demo',
      },
      {
        source: '/live-demo',
        destination: '/demo',
      },
    ];
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "50mb",
    },
  },
  webpack: (config) => {
    config.ignoreWarnings = [
      /Failed to parse source map/,
      /Invalid source map/,
      /sourceMapURL could not be parsed/,
    ];
    return config;
  },
};

export default pwa(nextConfig);