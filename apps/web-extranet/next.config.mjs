import { execSync } from 'node:child_process';

/**
 * The build's version, stamped into UX events and the error screen so a report can be tied to
 * the exact code that produced it. Deploys build from a git checkout; anywhere else it is "dev".
 */
function appVersion() {
  if (process.env.NEXT_PUBLIC_APP_VERSION) return process.env.NEXT_PUBLIC_APP_VERSION;
  try {
    return execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim();
  } catch {
    return 'dev';
  }
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace deps shipped as source, not build output: the framework-free domain package
  // (currency metadata, FX conversion), the regional reference data, and the design system
  // (React components with their 'use client' boundaries intact).
  transpilePackages: ['@yohobed/domain', '@yohobed/locale', '@yohobed/ui'],
  env: { NEXT_PUBLIC_APP_VERSION: appVersion() },
};

export default nextConfig;
