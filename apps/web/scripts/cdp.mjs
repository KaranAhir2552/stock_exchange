// Minimal Chrome DevTools Protocol helper for the scripts in this folder (headless Chrome, no dependencies).
import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const BASE = process.env.BASE_URL ?? "http://localhost:3000";
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Starts headless Chrome and returns a page driver. `width` < 700 emulates a phone. */
export async function openChrome({ width = 1520, height = 1200, port = 9335 } = {}) {
  const chrome = spawn(
    process.env.CHROME ?? "google-chrome",
    [
      "--headless=new",
      "--disable-gpu",
      "--no-sandbox",
      "--hide-scrollbars",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${mkdtempSync(join(tmpdir(), "afterbell-chrome-"))}`,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let target;
  for (let i = 0; i < 50 && !target; i++) {
    await sleep(200);
    try {
      target = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === "page");
    } catch {}
  }
  if (!target) throw new Error("Chrome did not start (set CHROME=/path/to/chrome)");
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener("open", r));
  let id = 0;
  const pending = new Map();
  ws.addEventListener("message", (m) => {
    const d = JSON.parse(m.data);
    if (!pending.has(d.id)) return;
    pending.get(d.id)(d);
    pending.delete(d.id);
  });
  const cmd = (method, params = {}) =>
    new Promise((r) => {
      const i = ++id;
      pending.set(i, r);
      ws.send(JSON.stringify({ id: i, method, params }));
    });
  await cmd("Page.enable");
  await cmd("DOM.enable");
  await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
  const page = {
    cmd,
    goto: (path) => cmd("Page.navigate", { url: `${BASE}${path}` }),
    eval: async (expr) =>
      (await cmd("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result
        ?.value,
    text: () => page.eval("document.body.innerText"),
    async waitFor(pred, what, ms = 90_000) {
      const t0 = Date.now();
      while (Date.now() - t0 < ms) {
        if (pred(await page.text())) return Date.now() - t0;
        await sleep(500);
      }
      throw new Error(`timeout waiting for ${what}`);
    },
    /** Clicks the first enabled button whose text includes `label`; false if none. */
    click: (label) =>
      page.eval(
        `(() => { const b = [...document.querySelectorAll("button")].find((b) => b.innerText.includes(${JSON.stringify(label)}) && !b.disabled); if (!b) return false; b.click(); return true; })()`,
      ),
    async setFile(selector, path) {
      const doc = await cmd("DOM.getDocument", {});
      const q = await cmd("DOM.querySelector", { nodeId: doc.result.root.nodeId, selector });
      await cmd("DOM.setFileInputFiles", { nodeId: q.result.nodeId, files: [path] });
    },
    async screenshot(file) {
      const h = await page.eval("document.documentElement.scrollHeight");
      await cmd("Emulation.setDeviceMetricsOverride", { width, height: h, deviceScaleFactor: 1, mobile: width < 700 });
      await sleep(300);
      const r = await cmd("Page.captureScreenshot", { format: "png" });
      writeFileSync(file, Buffer.from(r.result.data, "base64"));
      await cmd("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: width < 700 });
    },
    close() {
      ws.close();
      chrome.kill();
    },
  };
  return page;
}
