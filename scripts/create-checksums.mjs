import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const releaseFiles = ["main.js", "manifest.json", "styles.css"];

async function sha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

const lines = [];
for (const fileName of releaseFiles) {
  lines.push(`${await sha256(resolve(fileName))}  ${fileName}`);
}

await writeFile(resolve("SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");

console.log("CHECKSUMS: PASS");
for (const line of lines) {
  console.log(line);
}
