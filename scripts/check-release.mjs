import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { resolve } from "node:path";

const expectedTag = process.argv[2];
if (!expectedTag) {
  throw new Error("缺少 Release 标签，例如：npm run verify:release -- 0.1.0");
}

const readText = (fileName) => readFile(resolve(fileName), "utf8");
const readOptionalText = async (fileName) => {
  try {
    return await readText(fileName);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  }
};
const readJson = async (fileName) => JSON.parse(await readText(fileName));
const sha256 = (content) => createHash("sha256").update(content).digest("hex");
const escapeRegExp = (value) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

const [
  manifest,
  packageJson,
  versions,
  metadata,
  generatedSource,
  bundle,
  checksums,
  license,
  licenseOverview,
  contentLicense,
  readme,
] =
  await Promise.all([
    readJson("manifest.json"),
    readJson("package.json"),
    readJson("versions.json"),
    readJson("src/generated/electricity-trader-pack.meta.json"),
    readText("src/generated/electricity-trader-pack.ts"),
    readText("main.js"),
    readText("SHA256SUMS.txt"),
    readText("LICENSE"),
    readOptionalText("LICENSES.md"),
    readOptionalText("LICENSE-CONTENT.md"),
    readText("README.md"),
  ]);

assert(expectedTag === manifest.version, `标签 ${expectedTag} 与 manifest ${manifest.version} 不一致`);
assert(packageJson.version === manifest.version, "package.json 与 manifest.json 版本不一致");
assert(versions[manifest.version] === manifest.minAppVersion, "versions.json 缺少当前版本或最低版本不一致");
assert(manifest.id === "yiji-study", "插件 ID 必须为 yiji-study");
assert(manifest.isDesktopOnly === false, "发布版必须允许 Obsidian Mobile 加载");
assert(manifest.description.length <= 250, "插件描述不能超过 250 个字符");
assert(manifest.description.endsWith("."), "插件描述必须以英文句点结尾");
assert(packageJson.license !== "UNLICENSED", "package.json 必须声明许可证");
assert(license.startsWith("MIT License\n"), "根 LICENSE 必须使用 GitHub 可识别的标准 MIT 文本");
assert(licenseOverview.includes("LICENSE-CONTENT.md"), "双许可总览必须指向题库内容许可证");
assert(contentLicense.includes("CC BY-NC-ND 4.0"), "题库内容必须继续声明 CC BY-NC-ND 4.0");
assert(/## English[\s\S]+Yiji Study is/.test(readme), "README 必须包含社区目录要求的英文产品说明");

assert(metadata.schemaVersion === 1, "内置题包元数据版本不受支持");
assert(metadata.sourceFileCount === 20, "内置题包必须来自 20 个题源文件");
assert(metadata.questionCounts.single === 503, "单选题数量必须为 503");
assert(metadata.questionCounts.multiple === 277, "多选题数量必须为 277");
assert(metadata.questionCounts.judge === 305, "判断题数量必须为 305");
assert(metadata.questionCounts.total === 1085, "题目总数必须为 1085");
assert(/^[a-f0-9]{64}$/.test(metadata.sourceDigest), "题源摘要格式无效");
assert(generatedSource.includes(metadata.sourceDigest), "生成题包与元数据摘要不一致");

const generatedIds = generatedSource.match(/"id": "q_[a-f0-9]{16}"/g) ?? [];
assert(generatedIds.length === 1085, `生成题包实际仅发现 ${generatedIds.length} 个题目 ID`);
assert(new Set(generatedIds).size === 1085, "生成题包存在重复题目 ID");

const releaseFiles = ["main.js", "manifest.json", "styles.css"];
for (const fileName of releaseFiles) {
  const fileContent = await readFile(resolve(fileName));
  const fileStat = await stat(resolve(fileName));
  assert(fileStat.size > 0, `${fileName} 为空`);
  const checksumPattern = new RegExp(`^${sha256(fileContent)}  ${escapeRegExp(fileName)}$`, "m");
  assert(checksumPattern.test(checksums), `${fileName} 的 SHA-256 校验和缺失或不一致`);
}

assert(Buffer.byteLength(bundle) > 500_000, "main.js 体积异常，可能没有打包内置题库");
assert(!/\brequire\(["'](?:electron|node:fs|fs)["']\)/.test(bundle), "main.js 包含移动端不可用依赖");
assert(!bundle.includes("detachLeavesOfType"), "插件卸载时不应主动关闭自定义页面");

console.log(`RELEASE_CONTRACT: PASS (${manifest.id} ${manifest.version})`);
console.log(`CONTENT_PACK: PASS (${metadata.questionCounts.total} questions, ${metadata.sourceDigest})`);
console.log(`ASSETS: PASS (${releaseFiles.join(", ")}, SHA256SUMS.txt)`);
