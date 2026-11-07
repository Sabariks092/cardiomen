import type { NextConfig } from 'next';

const config: NextConfig = {
  transpilePackages: ['@cardiomen/contracts'],
  serverExternalPackages: ['@node-rs/argon2'],
  poweredByHeader: false,
};

export default config;
