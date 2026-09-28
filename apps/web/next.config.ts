import { resolve } from "node:path";
import { loadConfig } from "@afterbell/config";
import type { NextConfig } from "next";

// NETWORK picks config/<network>.json (validated) plus the git-ignored .env.<network>.
const cfg = loadConfig(process.env.NETWORK);

const nextConfig: NextConfig = {
  env: {
    // Everything here is public: it's inlined into the browser bundle (including RPC_URL).
    NEXT_PUBLIC_AFTERBELL_CONFIG: JSON.stringify(cfg),
    // Build-time constant, so demo-only code is dropped from builds without demo controls.
    NEXT_PUBLIC_DEMO: String(cfg.features.demoControls),
  },
  turbopack: { root: resolve(import.meta.dirname, "../..") },
};

export default nextConfig;
