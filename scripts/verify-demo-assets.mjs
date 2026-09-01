import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const catalogPath = resolve(
  repositoryRoot,
  "apps/web/src/composition/demo-assets.json",
);
const catalog = JSON.parse(readFileSync(catalogPath, "utf8"));
const failures = [];

if (!Array.isArray(catalog) || catalog.length !== 4)
  failures.push("demo-assets.json must contain exactly 4 assets");

for (const asset of Array.isArray(catalog) ? catalog : []) {
  const label = typeof asset?.name === "string" ? asset.name : "unknown asset";
  if (
    typeof asset?.path !== "string" ||
    typeof asset?.digest !== "string" ||
    typeof asset?.byteSize !== "number" ||
    typeof asset?.id !== "string"
  ) {
    failures.push(`${label}: incomplete catalog entry`);
    continue;
  }
  const publicPath = resolve(repositoryRoot, "apps/web/public", asset.path);
  if (!existsSync(publicPath)) {
    failures.push(`${asset.path}: missing`);
    continue;
  }
  if (typeof asset.sourcePath !== "string")
    failures.push(`${label}: sourcePath is missing`);
  else if (!existsSync(resolve(repositoryRoot, asset.sourcePath)))
    failures.push(`${asset.sourcePath}: missing`);

  const bytes = readFileSync(publicPath);
  const digest = createHash("sha256").update(bytes).digest("hex");
  if (digest !== asset.digest)
    failures.push(
      `${asset.path}: expected digest ${asset.digest}, received ${digest}`,
    );
  if (bytes.byteLength !== asset.byteSize)
    failures.push(
      `${asset.path}: expected ${asset.byteSize} bytes, received ${bytes.byteLength}`,
    );
  if (asset.id !== `asset-${asset.digest.slice(0, 24)}`)
    failures.push(`${label}: id is not derived from its digest`);

  const riff = bytes.subarray(0, 4).toString("ascii") === "RIFF";
  const format = bytes.subarray(8, 12).toString("ascii");
  if (asset.mimeType === "image/webp" && (!riff || format !== "WEBP"))
    failures.push(`${asset.path}: not a WebP RIFF file`);
  if (asset.mimeType === "audio/wav" && (!riff || format !== "WAVE"))
    failures.push(`${asset.path}: not a WAV RIFF file`);
  if (
    !["backdrop", "music"].includes(asset.kind) ||
    typeof asset.license !== "string" ||
    asset.license.length === 0
  )
    failures.push(`${label}: kind or license is invalid`);
}

if (failures.length > 0) {
  process.stderr.write(
    `Demo asset verification failed:\n${failures.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified ${catalog.length} demo assets\n`);
}
