import type { NextConfig } from "next";
const nextConfig: NextConfig = {
  ...(process.platform === "win32" ? {} : { output: "standalone" as const }),
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/(login|profile|partner|admin)/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store, private" },
          { key: "Referrer-Policy", value: "no-referrer" },
        ],
      },
      {
        source: "/sw.js",
        headers: [{ key: "Cache-Control", value: "no-cache" }],
      },
    ];
  },
};
export default nextConfig;
