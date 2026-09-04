import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const [manifestText, css, viewSource, contentSource, bundle] = await Promise.all([
  readFile(resolve(projectRoot, "manifest.json"), "utf8"),
  readFile(resolve(projectRoot, "styles.css"), "utf8"),
  readFile(resolve(projectRoot, "src/ui/yiji-view.ts"), "utf8"),
  readFile(resolve(projectRoot, "src/content/content-package.ts"), "utf8"),
  readFile(resolve(projectRoot, "main.js"), "utf8"),
]);

const manifest = JSON.parse(manifestText);
assert.equal(manifest.id, "yiji-study", "插件 ID 必须保持为 yiji-study");
assert.match(
  manifest.name,
  /^[A-Za-z0-9 +()-]+$/,
  "社区目录显示名只能使用 Obsidian 允许的 Basic Latin 字母、数字、空格和有限标点",
);
assert.equal(manifest.isDesktopOnly, false, "插件必须允许在 Obsidian Mobile 加载");

assert.match(css, /\.yiji-root\s*\{[^}]*font-size:\s*17px/s, "正文基准字号必须至少为 17px");
assert.match(css, /\.yiji-root button\s*\{[^}]*min-height:\s*44px/s, "按钮触控高度必须至少为 44px");
assert.match(css, /\.yiji-question-title\s*\{[^}]*font-size:\s*22px/s, "题干字号必须为 22px");
assert.match(css, /\.yiji-question-title\s*\{[^}]*line-height:\s*1\.75/s, "题干行高必须为 1.75");
assert.match(css, /\.yiji-option\s*\{[^}]*min-height:\s*64px/s, "答题选项高度必须至少为 64px");
assert.match(
  css,
  /--yiji-host-bottom-offset:\s*var\(--view-bottom-spacing,\s*0px\)/,
  "底部操作必须读取 Obsidian 视图底部留白",
);
assert.match(
  css,
  /--yiji-safe-bottom:\s*var\(--safe-area-inset-bottom,\s*env\(safe-area-inset-bottom,\s*0px\)\)/,
  "底部操作必须保留系统安全区回退",
);
assert.match(css, /@media \(max-width:\s*375px\)/, "必须覆盖 375px 手机宽度");
assert.match(css, /@media \(prefers-reduced-motion:\s*reduce\)/, "必须尊重减少动态效果设置");
assert.doesNotMatch(css, /\bui-monospace\b/, "字体栈不能依赖旧版 Obsidian 不支持的扩展系统字体关键字");

assert.match(
  viewSource,
  /\["home",\s*"book-open",\s*"题库"\][\s\S]*\["exam",\s*"clipboard-check",\s*"模考"\][\s\S]*\["stats",\s*"chart-no-axes-column",\s*"统计"\]/,
  "一级导航必须依次为题库、模考、统计",
);
assert.doesNotMatch(viewSource, /\["wrongbook"[^\n]*"错题"/, "错题不能成为一级导航");
assert.match(viewSource, /统计 \/ 错题本/, "错题本必须保留统计二级路径");
assert.match(contentSource, /questionCount:\s*100[\s\S]*questionCount:\s*30[\s\S]*questionCount:\s*40/, "模考题型与题量必须固定");
assert.match(contentSource, /durationMinutes:\s*120[\s\S]*totalScore:\s*100/, "模考时长与分值必须固定");
assert.match(contentSource, /第 1 套样卷[\s\S]*第 2 套样卷[\s\S]*模拟卷 5/, "模考页必须展示两套原卷和五套模拟卷");
assert.doesNotMatch(viewSource, /今日任务|连续学习|打卡|困难|熟练|记忆程度/, "界面不能包含任务化或四档自评文案");
assert.doesNotMatch(viewSource, /Study_Vault\/电力交易员/, "内容包路径不能散落在通用界面中");

assert.doesNotMatch(bundle, /\belectron\b|node:fs|require\(["']fs["']\)/, "移动端包不能依赖 Electron 或 Node 文件系统");

console.log("UI_CONTRACT: PASS");
console.log("- mobile manifest: PASS");
console.log("- typography and touch targets: PASS");
console.log("- navigation and product copy: PASS");
console.log("- desktop-only dependency scan: PASS");
