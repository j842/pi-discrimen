import { readFileSync, writeFileSync } from "node:fs";

const packagePath = new URL("../package.json", import.meta.url);
const manifestPath = new URL("../extension-manifest.json", import.meta.url);
const { version } = JSON.parse(readFileSync(packagePath, "utf8"));
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.version = version;
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
