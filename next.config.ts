import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // pdfjs-dist must stay external so the route handler loads it via native require at
  // runtime (Turbopack must not bundle its dynamic font/worker graph).
  serverExternalPackages: ["pdfjs-dist"],
  /* config options here */
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
