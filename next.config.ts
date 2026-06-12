import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Server-only packages that must not be bundled by webpack/turbopack:
  // they spawn processes (@cursor/sdk) or open raw sockets (playwright-core).
  serverExternalPackages: ["@cursor/sdk", "@onkernel/sdk", "playwright-core"],
};

export default nextConfig;
