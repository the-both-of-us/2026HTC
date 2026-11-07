import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Builds a self-contained server for the Docker image. Vercel handles this itself.
  output: "standalone",
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
