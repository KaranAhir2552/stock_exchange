// CI guard: fails if config/mainnet.json enables mock oracle, demo controls, or Mock pools.
import { mainnetSafetyErrors, readRawConfig } from "./index.ts";

const errors = mainnetSafetyErrors(readRawConfig("mainnet") as Parameters<typeof mainnetSafetyErrors>[0]);
if (errors.length) {
  console.error(`config/mainnet.json is unsafe:\n  ${errors.join("\n  ")}`);
  process.exit(1);
}
console.log("config/mainnet.json: no mock oracle, no demo controls, no Mock pools");
