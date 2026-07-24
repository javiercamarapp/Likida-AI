import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  serverExternalPackages: ['sharp', 'jsqr', 'pdf-lib'],
};

export default nextConfig;
