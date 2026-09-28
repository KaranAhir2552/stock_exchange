"use client";
import dynamic from "next/dynamic";
import { notFound } from "next/navigation";

// NEXT_PUBLIC_DEMO is replaced by a string literal at build time (features.demoControls), so when it is
// "false" the bundler drops this import and the panel is not shipped at all. The check is written out here
// (not imported) because constants are only folded within one module. Mainnet: `pnpm check:mainnet`.
const DemoPanel = process.env.NEXT_PUBLIC_DEMO === "true" ? dynamic(() => import("./DemoPanel"), { ssr: false }) : null;

export default function DemoPage() {
  if (!DemoPanel) notFound();
  return <DemoPanel />;
}
