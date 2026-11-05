import esbuild from "esbuild";
import process from "node:process";
import { builtinModules } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

await writeFile("styles.css", `${await readFile("styles-base.css", "utf8")}\n${await readFile("styles-manager.css", "utf8")}`);

const production = process.argv[2] === "production";
const context = await esbuild.context({
  banner: {
    js: "/* 易记 Obsidian 插件：此文件由 esbuild 生成。 */",
  },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: [
    "obsidian",
    "electron",
    "@codemirror/autocomplete",
    "@codemirror/collab",
    "@codemirror/commands",
    "@codemirror/language",
    "@codemirror/lint",
    "@codemirror/search",
    "@codemirror/state",
    "@codemirror/view",
    "@lezer/common",
    "@lezer/highlight",
    "@lezer/lr",
    ...builtinModules,
  ],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  outfile: "main.js",
  minify: production,
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
