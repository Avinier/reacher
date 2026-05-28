import { resolve } from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@reacher/shared"],
  outputFileTracingRoot: resolve(__dirname, "../.."),
  serverExternalPackages: []
};

export default nextConfig;
