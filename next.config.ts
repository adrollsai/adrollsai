// adrollsai/adrollsai/adrollsai-adrollsai-version3/next.config.ts

import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const pwa = withPWA({
  dest: "public",
  register: true,
  disable: process.env.NODE_ENV === 'development',
  // The start URL is a per-user document (logged in or not), so caching it means
  // a phone can boot into a shell for a build that no longer exists.
  cacheStartUrl: false,
  // This is the runtime twin of cacheStartUrl: with it on, `/` is served
  // NetworkFirst from the 'start-url' cache — the same stale-shell trap, on the
  // one URL every installed PWA opens.
  dynamicStartUrl: false,
  // WHAT WAS BEING PRECACHED
  // ------------------------
  // next-pwa precaches everything in `public/`, which here includes other
  // tenants' demo sites and campaign media. Measured against the deployment:
  // 558 precache entries, 24 MB — and a service worker downloads all of it
  // before it can activate. On a phone that is a long, invisible wait, during
  // which `navigator.serviceWorker.ready` never resolves (which is also why
  // enabling notifications failed) and the app looks stuck.
  //
  // These are tenant marketing assets and demo folders, not the app. If a page
  // really needs one, the runtime image route caches it on demand.
  //
  // NOTE THE SHAPE OF THESE PATTERNS: they are fast-glob patterns run with
  // `cwd: public/`, so they must NOT start with a slash — `!/amritha-vana/**`
  // matches nothing and silently leaves all 24 MB in place. (`manifestTransforms`
  // does not help either: these entries come in as additionalManifestEntries,
  // which workbox adds AFTER the transforms run.)
  publicExcludes: [
    '!**/*.{mp4,webm,mp3,wav,zip,csv}',
    '!amritha-vana/**',
    '!amritha-vana-logo.png',
    '!campaign-assets/**',
    '!real-estate-template/**',
    '!images/**',
    '!logos/**',
    '!adrolls_dashboard_mockup.png',
    '!indian_owner_busy.png',
    '!happy_retail_owner.png',
    '!happy_business_owner.png',
    '!nobogent-logo.png',
    '!shihtzu.png',
    '!nobo-character.jpg',
    '!nobo-mascot.jpg',
    '!og-image.jpg',
    // A stale duplicate of custom-sw.js that nothing registers.
    '!sw-v2.js',
  ],
  // Keep the plugin's useful defaults (hashed JS/CSS, fonts, images, media) and
  // let the entries below replace the dangerous ones by reusing their cacheName.
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    disableDevLogs: true,
    skipWaiting: true,
    clientsClaim: true,
    importScripts: ['/custom-sw.js'],
    runtimeCaching: [
      /*
       * NEVER serve a page from cache.
       *
       * The default entry here was NetworkFirst with a 24 hour TTL for every
       * same-origin GET, which includes every /dashboard navigation. A deployed
       * Next build emits new chunk filenames on every deploy, so a cached page
       * document names chunks that no longer exist: the browser loads an HTML
       * shell whose JS 404s, and the app sits on its loading skeleton forever.
       * That is the reported "stuck on loading" on an installed PWA, and it gets
       * worse the more often we deploy.
       *
       * A navigation must always be the network's answer. The static assets it
       * then asks for are still cached (they are content-hashed, so a cached one
       * is always the right one).
       */
      {
        urlPattern: ({ request }: any) => request.mode === 'navigate',
        handler: 'NetworkOnly' as const,
        options: { cacheName: 'pages' },
      },
      {
        urlPattern: ({ request }: any) => request.headers.get('RSC') === '1',
        handler: 'NetworkOnly' as const,
        options: { cacheName: 'pages-rsc' },
      },
      {
        urlPattern: ({ request }: any) =>
          request.headers.get('RSC') === '1' && request.headers.get('Next-Router-Prefetch') === '1',
        handler: 'NetworkOnly' as const,
        options: { cacheName: 'pages-rsc-prefetch' },
      },
      // API responses are per-user and authenticated. A cached one is either
      // stale or somebody else's; either way it is not an answer.
      {
        urlPattern: ({ url }: any) => url.pathname.startsWith('/api/'),
        handler: 'NetworkOnly' as const,
        options: { cacheName: 'apis' },
      },
    ],
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