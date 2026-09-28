// End-to-end check of the devnet demo (brief Phase 4 "done when"): loads the admin key into /demo, runs every
// step against the real cluster and times it. node scripts/demo.mjs [--stop-after N] [--shots DIR]
//   BASE_URL (default http://localhost:3000), ADMIN_KEYPAIR_PATH (default ~/.config/solana/id.json)
import { homedir } from "node:os";
import { parseArgs } from "node:util";
import { openChrome, sleep } from "./cdp.mjs";

const { values } = parseArgs({ options: { "stop-after": { type: "string" }, shots: { type: "string" } } });
const key = (process.env.ADMIN_KEYPAIR_PATH ?? "~/.config/solana/id.json").replace(/^~/, homedir());
const steps = [
  ["Start a simulated week", "New simulated week"],
  ["Friday close", "Market closed"],
  ["Weekend news", "Swap rejected"],
  ["Trading halt", "Withdrawal succeeded"],
  ["Halt ends", "Halt over"],
  ["Monday open", "Re-centred"],
].slice(0, Number(values["stop-after"] ?? 6));

const page = await openChrome({ height: 2100 });
await page.goto("/demo");
await page.waitFor((t) => t.includes("Load the devnet admin key"), "demo page");
await page.setFile("input[type=file]", key);
await page.waitFor((t) => t.includes("Admin key loaded"), "admin key");
const t0 = Date.now();
let failed = false;
for (const [i, [label, done]] of steps.entries()) {
  const before = (await page.text()).split(done).length;
  let clicked = false;
  for (let n = 0; n < 40 && !clicked; n++) {
    clicked = (await page.click(label)) || (i === 0 && (await page.click("Reset (new week)")));
    if (!clicked) await sleep(500);
  }
  if (!clicked) throw new Error(`button not clickable: ${label}`);
  const ms = await page.waitFor((t) => t.split(done).length > before || / failed\n/.test(t), label);
  const err = (await page.text()).match(/\w[\w ]+ failed\n?[^\n]*/)?.[0];
  failed ||= !!err;
  console.log(`${label}: ${(ms / 1000).toFixed(1)}s${err ? `  FAILED: ${err}` : ""}`);
  await sleep(1500);
  if (values.shots) await page.screenshot(`${values.shots}/demo-${i}.png`);
}
console.log(`total: ${((Date.now() - t0) / 1000).toFixed(1)}s`);
page.close();
if (failed) process.exitCode = 1;
