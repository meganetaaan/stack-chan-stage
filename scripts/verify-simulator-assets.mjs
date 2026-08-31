import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const expected = new Map([
  [
    "apps/web/public/simulator/mc.js",
    "1f50e6cb39ebdbe10557012726d59b2c7507080289db0f6faed6bded832761ee",
  ],
  [
    "apps/web/public/simulator/mc.wasm",
    "2cdbba042963a6359aef034ef82c4e2fe6b7c1abf3357c1e47ebc631a763f324",
  ],
  [
    "apps/web/public/simulator/stage-client.xsa",
    "529dee1be06d5f9a25fbf88ab04c0dbadcf149e74d7380240d8c9ab2c88ec936",
  ],
  [
    "apps/web/public/simulator/assets/case/v1/shell.stl",
    "832ced3ad3669c3fc6b174a984cc800522ca33cecd9222d531bda430f6cc5236",
  ],
]);

const failures = [];
for (const [relativePath, expectedDigest] of expected) {
  const path = resolve(repositoryRoot, relativePath);
  if (!existsSync(path)) {
    failures.push(`${relativePath}: missing`);
    continue;
  }
  const actualDigest = createHash("sha256")
    .update(readFileSync(path))
    .digest("hex");
  if (actualDigest !== expectedDigest)
    failures.push(
      `${relativePath}: expected ${expectedDigest}, received ${actualDigest}`,
    );
}

if (failures.length > 0) {
  process.stderr.write(
    `Simulator asset verification failed:\n${failures.join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write(`Verified ${expected.size} simulator assets\n`);
}
