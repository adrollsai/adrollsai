import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  experimental: {
    serverComponentsExternalPackages: ['@supabase/supabase-js'],
  },
};

export default nextConfig;
