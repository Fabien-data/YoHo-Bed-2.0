/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The framework-free domain package (currency metadata, FX conversion) is a workspace dep.
  transpilePackages: ['@yohobed/domain'],
};

export default nextConfig;
