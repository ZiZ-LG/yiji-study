import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const browserCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

const browserPath = browserCandidates.find((candidate) => existsSync(candidate));
assert.ok(browserPath, "未找到 Chromium 浏览器；可通过 CHROME_PATH 指定可执行文件");

const fixtureUrl = pathToFileURL(resolve("tests/fixtures/mobile-layout.html")).href;
const result = spawnSync(
  browserPath,
  [
    "--headless=new",
    "--disable-gpu",
    "--disable-background-networking",
    "--disable-component-update",
    "--disable-sync",
    "--no-first-run",
    "--no-default-browser-check",
    "--no-sandbox",
    "--allow-file-access-from-files",
    "--virtual-time-budget=1000",
    "--dump-dom",
    fixtureUrl,
  ],
  { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, timeout: 15_000 },
);

const match = result.stdout.match(/data-layout-result="([^"]+)"/);
assert.equal(result.status, 0, result.stderr || "Chromium 布局检查未正常退出");
assert.ok(match, "页面未返回移动布局测量结果");
const layout = JSON.parse(decodeURIComponent(match[1]));
console.log("MOBILE_LAYOUT_MEASURE:", JSON.stringify(layout));

assert.ok(layout.navBottomClearance >= 84, `底部导航仅避让 ${layout.navBottomClearance}px`);
assert.ok(layout.dockBottomClearance >= 84, `答题操作栏仅避让 ${layout.dockBottomClearance}px`);
assert.ok(layout.navScrollPaddingBottom >= 188, `导航页滚动留白仅 ${layout.navScrollPaddingBottom}px`);
assert.ok(layout.dockScrollPaddingBottom >= 196, `答题页滚动留白仅 ${layout.dockScrollPaddingBottom}px`);
assert.ok(layout.domainTitleOverflow <= 1, `知识域标题横向溢出 ${layout.domainTitleOverflow}px`);
assert.ok(layout.domainTitleRightOverflow <= 1, `知识域标题越过卡片右边界 ${layout.domainTitleRightOverflow}px`);
assert.ok(layout.domainTitleHeight >= 40, `长知识域标题未换行，高度仅 ${layout.domainTitleHeight}px`);
assert.ok(layout.optionHeight >= 64, `选项按钮高度仅 ${layout.optionHeight}px`);
assert.equal(layout.optionKeyContained, true, "选项序号框越过了选项按钮边界");
assert.ok(layout.optionCopyOverflow <= 1, `选项文字横向溢出 ${layout.optionCopyOverflow}px`);

console.log("MOBILE_LAYOUT: PASS");
