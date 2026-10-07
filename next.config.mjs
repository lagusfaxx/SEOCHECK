/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ["pg-boss", "@prisma/client", "playwright-core", "cheerio"] },
};
export default nextConfig;
