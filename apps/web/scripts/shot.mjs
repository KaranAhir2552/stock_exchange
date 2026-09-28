// Screenshot (and width check) of one page: node scripts/shot.mjs <path> <out.png> [width] [waitMs]
import { openChrome, sleep } from "./cdp.mjs";

const [path = "/", out = "shot.png", width = "1520", wait = "9000"] = process.argv.slice(2);
const page = await openChrome({ width: Number(width) });
await page.goto(path);
await sleep(Number(wait));
const scrollWidth = await page.eval("document.documentElement.scrollWidth");
await page.screenshot(out);
console.log(JSON.stringify({ path, out, width: Number(width), scrollWidth, fits: scrollWidth <= Number(width) }));
page.close();
