/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Workspace deps shipped as source, not build output: the framework-free domain package
  // (currency metadata, FX conversion), the regional reference data, and the design system
  // (React components with their 'use client' boundaries intact).
  transpilePackages: ['@yohobed/domain', '@yohobed/locale', '@yohobed/ui'],
};

export default nextConfig;
