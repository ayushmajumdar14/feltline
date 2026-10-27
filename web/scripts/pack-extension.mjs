import { cp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repoExt = resolve(root, "../extension");
const destDir = resolve(root, "public/feltline-extension");
const destZip = resolve(root, "public/feltline-extension.zip");
const publicDir = resolve(root, "public");

function shouldCopy(path) {
  return !path.endsWith(".DS_Store") && !path.endsWith("README.md") && !path.endsWith(".zip");
}

if (existsSync(repoExt)) {
  await rm(destDir, { recursive: true, force: true });
  await mkdir(destDir, { recursive: true });
  await cp(repoExt, destDir, { recursive: true, filter: shouldCopy });
}

if (!existsSync(destDir)) {
  console.warn("pack-extension: no extension files, skip");
  process.exit(0);
}

const manifestPath = resolve(destDir, "manifest.json");
if (existsSync(manifestPath)) {
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  manifest.host_permissions = (manifest.host_permissions || []).filter((p) => !p.includes("localhost") && !p.includes("127.0.0.1"));
  manifest.content_scripts = (manifest.content_scripts || []).map((cs) => ({
    ...cs,
    matches: (cs.matches || []).filter((p) => !p.includes("localhost") && !p.includes("127.0.0.1")),
  }));
  await writeFile(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
}

await writeFile(
  resolve(destDir, "INSTALL.txt"),
  `Feltline Chrome extension
========================

This zip is only the extension. It is not the GitHub repo.

1. Unzip this file. You should get a folder named feltline-extension
   that contains manifest.json.

2. In Chrome open:  chrome://extensions

3. Turn on Developer mode (top right).

4. Click "Load unpacked" and choose the feltline-extension folder
   (the one that contains manifest.json).

5. Go to https://feltline-ten.vercel.app sign in, add your Poker Now
   table, then open that game in this same Chrome profile.

6. Open the table's coach page on Feltline. Take / Override / Ignore
   there; the extension clicks on Poker Now.
`,
);

await rm(destZip, { force: true });
const py = `
import pathlib, zipfile
root = pathlib.Path(${JSON.stringify(publicDir)})
folder = root / "feltline-extension"
zpath = root / "feltline-extension.zip"
with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
    for p in folder.rglob("*"):
        if p.is_file():
            z.write(p, p.relative_to(root).as_posix())
print("wrote", zpath)
`;
execFileSync("python3", ["-c", py], { stdio: "inherit" });
