import esbuild from "esbuild";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const projectRoot = process.cwd();
const temporaryDirectory = await mkdtemp(join(tmpdir(), "yiji-content-"));
const executablePath = join(temporaryDirectory, "generate-content-pack.mjs");

try {
  await esbuild.build({
    entryPoints: [resolve(projectRoot, "scripts/generate-content-pack.ts")],
    outfile: executablePath,
    bundle: true,
    platform: "node",
    format: "esm",
    target: "node18",
    logLevel: "warning",
  });
  await import(`${pathToFileURL(executablePath).href}?run=${Date.now()}`);
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
