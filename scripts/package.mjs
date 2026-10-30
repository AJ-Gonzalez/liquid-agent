// Packs the app into a runnable bundle for one platform and architecture.
// `npm run app:package -- --platform=darwin --arch=arm64`
// Nothing is code-signed: the bundle runs, but macOS and Windows will ask the
// first time it is opened elsewhere.

import { packager } from "@electron/packager";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function option(name, fallback) {
  const prefix = `--${name}=`;
  const hit = process.argv.slice(2).find((arg) => arg.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

const targets = (option("platform", process.platform).split(",")).flatMap((platform) =>
  option("arch", process.arch)
    .split(",")
    .map((arch) => ({ platform: platform.trim(), arch: arch.trim() })),
);

// Everything the running app never reads: sources, tests, tooling, release
// output. `prune` drops devDependencies, leaving only `ws` next to the server.
const ignore = [
  /^\/\.git($|\/)/,
  /^\/\.github($|\/)/,
  /^\/release[^/]*($|\/)/,
  /^\/bridge($|\/)/,
  /^\/guardian($|\/)/,
  /^\/scripts($|\/)/,
  /^\/web\/src($|\/)/,
  /^\/web\/public($|\/)/,
  /^\/web\/tsconfig\.json$/,
  /^\/web\/index\.html$/,
  /^\/vite\.config\.js$/,
  /^\/install\.sh$/,
  /^\/Liquid Agent\.command$/,
  /^\/README\.md$/,
  /^\/package-lock\.json$/,
];

/** Packager leaves the folders of pruned modules behind, empty. */
function removeEmptyDirs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const child = path.join(dir, entry.name);
    removeEmptyDirs(child);
    try {
      fs.rmdirSync(child);
    } catch {
      // not empty: a real module
    }
  }
}

for (const target of targets) {
  const [out] = await packager({
    dir: ROOT,
    out: path.join(ROOT, "release-electron"),
    name: "Liquid Agent",
    platform: target.platform,
    arch: target.arch,
    electronVersion: pkg.devDependencies.electron.replace(/^[^0-9]*/, ""),
    appVersion: pkg.version,
    overwrite: true,
    asar: false,
    prune: true,
    ignore,
  });
  for (const app of [path.join(out, "Liquid Agent.app", "Contents", "Resources", "app"), path.join(out, "resources", "app")]) {
    const modules = path.join(app, "node_modules");
    if (fs.existsSync(modules)) removeEmptyDirs(modules);
  }
  console.log(`✓ ${target.platform}/${target.arch} → ${path.relative(ROOT, out)}`);
}
