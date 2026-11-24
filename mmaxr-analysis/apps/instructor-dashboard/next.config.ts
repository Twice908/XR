import type { NextConfig } from "next";

// STATIC_EXPORT=1 builds a plain static site (Cloudflare Pages); otherwise the normal Next server build.
const staticExport = process.env.STATIC_EXPORT === "1";

const nextConfig: NextConfig = staticExport
  ? { output: "export", trailingSlash: false, images: { unoptimized: true } }
  : { cacheComponents: true, partialPrefetching: true };

export default nextConfig;
