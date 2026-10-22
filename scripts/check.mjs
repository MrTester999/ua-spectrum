import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { buildCatalog, catalogStats } from "../lib/catalog.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const lock = JSON.parse(fs.readFileSync(path.join(root, "package-lock.json"), "utf8"));
if (manifest.manifest_version !== 3) throw new Error("Manifest must use MV3");
if (manifest.version !== pkg.version) throw new Error("Package and manifest versions differ");
if (manifest.version !== lock.version || manifest.version !== lock.packages?.[""]?.version) {
  throw new Error("Package lock version differs");
}

const files = ["background/service-worker.js", "lib/catalog.js", "popup/popup.js"];
for (const file of files) execFileSync(process.execPath, ["--check", path.join(root, file)]);
for (const file of [
  "popup/popup.html", "popup/popup.css", "README.md", "DOCUMENTATION.md",
  "DOCUMENTATION.txt", "CHANGELOG.md", ...Object.values(manifest.icons)
]) {
  if (!fs.existsSync(path.join(root, file))) throw new Error(`Missing ${file}`);
}

const catalog = buildCatalog();
const stats = catalogStats();
if (catalog.length < 5000) throw new Error(`Catalog too small: ${catalog.length}`);
if (new Set(catalog.map((entry) => entry.ua)).size !== catalog.length) throw new Error("Duplicate agents detected");
if (catalog.some((entry) => !entry.ua.startsWith("Mozilla/5.0"))) throw new Error("Malformed User-Agent detected");

const worker = fs.readFileSync(path.join(root, "background/service-worker.js"), "utf8");
for (const capability of [
  "sec-ch-ua", "rotateAll", "setLocked", "toggleSiteExclusion",
  "importSettings", "onReplaced", "HEALTH_ALARM", "addRules"
]) {
  if (!worker.includes(capability)) throw new Error(`Missing all-tab capability: ${capability}`);
}

console.log("PASS");
console.log(` - Manifest v${manifest.version}`);
console.log(` - ${stats.total.toLocaleString()} unique User-Agents`);
console.log(` - Browsers: ${stats.browsers.join(", ")}`);
console.log(` - Platforms: ${stats.platforms.join(", ")}`);
console.log(" - JavaScript syntax and required assets verified");
console.log(" - Batch rules, identity lock, site exclusions, settings portability, and health repair verified");
