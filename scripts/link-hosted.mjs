// The hosted connector imports the package by name. For its tests that name must mean this checkout's
// own build, not a published version: production bundles the connector against the same commit's source.
import { existsSync, lstatSync, mkdirSync, rmSync, symlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
if (!existsSync(join(root, "dist", "index.js"))) {
  console.error("dist/ is missing: run `bun run build` first, the hosted tests run against it.");
  process.exit(1);
}
if (!existsSync(join(root, "hosted", "node_modules", "@neondatabase"))) {
  console.error("hosted/node_modules is missing: run `npm ci --prefix hosted --ignore-scripts` first.");
  process.exit(1);
}
const link = join(root, "hosted", "node_modules", "cloud-alm-mcp-server");
if (!(existsSync(link) && lstatSync(link).isSymbolicLink())) {
  rmSync(link, { recursive: true, force: true });
  mkdirSync(dirname(link), { recursive: true });
  symlinkSync(root, link, "dir");
}
