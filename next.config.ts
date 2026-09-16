import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  // Local-only enriched rows (output/, gitignored) must never enter a route
  // trace or the deploy upload. Route keys are picomatch-matched with
  // `contains`, so `/**` covers `/` as well as nested routes.
  outputFileTracingExcludes: {
    "/**": ["./output/**"],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
        ],
      },
    ];
  },
};

export default nextConfig;
