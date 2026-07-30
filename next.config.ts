import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The seed corpus is read from disk at request time. File tracing can't see
  // a dynamic readdir, so include it explicitly or the markdown is missing
  // from the deployed bundle.
  outputFileTracingIncludes: {
    "/*": ["./content/**/*"],
  },
};

export default nextConfig;
