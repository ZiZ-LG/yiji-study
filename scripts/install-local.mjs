import { copyFile, mkdir, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pluginDirectory = resolve(projectRoot, ".obsidian", "plugins", "yiji-study");
const releaseFiles = ["main.js", "manifest.json", "styles.css"];

for (const fileName of releaseFiles) {
  const source = resolve(projectRoot, fileName);
  const metadata = await stat(source).catch(() => null);
  if (!metadata?.isFile()) {
    throw new Error(`缺少发布文件：${fileName}。请先运行 npm run build。`);
  }
}

await mkdir(pluginDirectory, { recursive: true });
for (const fileName of releaseFiles) {
  await copyFile(resolve(projectRoot, fileName), resolve(pluginDirectory, fileName));
}

console.log(`易记已复制到：${pluginDirectory}`);
console.log(`发布文件：${releaseFiles.join("、")}`);
console.log("脚本未修改 community-plugins.json；请在 Obsidian 中手动启用“易记”。");
