import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { mkdir, writeFile, copyFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import { build } from "esbuild";

const directory = resolve(".artifacts/exam-ui");
await mkdir(directory, { recursive: true });
await build({ entryPoints: ["tests/fixtures/exam-ui.ts"], bundle: true, format: "iife",
  outfile: resolve(directory, "app.js"), alias: { obsidian: resolve("tests/fixtures/obsidian-exam-stub.ts") } });
await copyFile("styles.css", resolve(directory, "styles.css"));
await writeFile(resolve(directory, "index.html"), `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
<title>易记 · 实际界面回归测试宿主</title><style>
:root { --input-height:36px; --safe-area-inset-bottom:34px; --view-bottom-spacing:86px; }
* { box-sizing:border-box } body { margin:0; background:#ddd; }
button { height:var(--input-height); padding:4px 12px; white-space:nowrap; }
#app { position:relative; width:390px; height:780px; overflow:hidden; }
</style><link rel="stylesheet" href="styles.css"><body><div id="app"></div><script src="app.js"></script></body></html>`);
// Match the established layout check: prefer native Chrome over Linux snap launchers.
const executable = [process.env.CHROME_PATH, "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium", "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable", "/usr/bin/chromium", "/usr/bin/chromium-browser"].find((path) => path && existsSync(path));
assert.ok(executable, "Chromium is required for the exam UI check");
console.log(`EXAM_UI_BROWSER: ${executable}`);
for (const [width, platform] of [[320, "ios"], [390, "ios"], [430, "android"]]) {
  const url = `${pathToFileURL(resolve(directory, "index.html")).href}?width=${width}&platform=${platform}`;
  const result = spawnSync(executable, ["--headless=new", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--disable-component-update", "--disable-sync", "--no-sandbox",
    "--allow-file-access-from-files", "--virtual-time-budget=10000", "--dump-dom", url],
  { encoding: "utf8", maxBuffer: 2 * 1024 * 1024, timeout: 60_000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr);
  const encoded = result.stdout.match(/data-exam-result="([^"]+)"/)?.[1];
  if (!encoded) {
    await writeFile(resolve(directory, `failure-${width}-${platform}.html`), result.stdout);
    console.error(result.stderr.slice(-2000), result.stdout.slice(-2000));
  }
  assert.ok(encoded, "Browser did not finish the exam workflow");
  const report = JSON.parse(decodeURIComponent(encoded));
  console.log("EXAM_UI:", JSON.stringify({ platform, ...report }));
  assert.equal(report.status, "PASS", report.message);
}
console.log(`Interactive preview: ${pathToFileURL(resolve(directory, "index.html")).href}?preview=exam`);
