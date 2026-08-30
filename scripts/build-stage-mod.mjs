import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const MODDABLE_VERSION = "9.0.0";
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moddable = process.env.MODDABLE;
if (!moddable)
  throw new Error("MODDABLE must point to a Moddable SDK checkout");
const actualModdableVersion = readFileSync(
  join(moddable, "tools", "VERSION"),
  "utf8",
).trim();
if (actualModdableVersion !== MODDABLE_VERSION)
  throw new Error(
    `Moddable SDK ${MODDABLE_VERSION} is required (found ${actualModdableVersion})`,
  );

const hostPlatform =
  process.platform === "darwin"
    ? "mac"
    : process.platform === "win32"
      ? "win"
      : "lin";
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const toolDirectory =
  process.env.MODDABLE_TOOLS ??
  join(moddable, "build", "bin", hostPlatform, "release");
const environment = {
  ...process.env,
  MODDABLE: moddable,
  PATH: `${toolDirectory}${delimiter}${process.env.PATH ?? ""}`,
};
const temporaryOutput = mkdtempSync(join(tmpdir(), "stackchan-stage-mod-"));
const manifest = join(
  repositoryRoot,
  "firmware",
  "mods",
  "stackchan-stage-client",
  "manifest.json",
);
const target = join(
  repositoryRoot,
  "apps",
  "web",
  "public",
  "simulator",
  "stage-client.xsa",
);

const run = (command, args) => {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status}`);
};

try {
  run(`mcrun${executableSuffix}`, [
    "-p",
    "wasm",
    "-t",
    "build",
    "-o",
    temporaryOutput,
    manifest,
  ]);
  const commandFile = join(
    temporaryOutput,
    "tmp",
    "wasm",
    "release",
    "stackchan-stage-client",
    "make.json",
  );
  const commands = JSON.parse(readFileSync(commandFile, "utf8"));
  if (!Array.isArray(commands)) throw new Error("Invalid mcrun command file");
  for (const entry of commands) {
    if (
      !Array.isArray(entry) ||
      !entry.every((part) => typeof part === "string")
    )
      throw new Error("Invalid command in mcrun output");
    const [command, ...args] = entry;
    const outputIndex = args.indexOf("-o");
    if (outputIndex >= 0 && args[outputIndex + 1])
      mkdirSync(args[outputIndex + 1], { recursive: true });
    if (command === "xsa")
      run(join(toolDirectory, `tools${executableSuffix}`), ["xsa", ...args]);
    else run(join(toolDirectory, `${command}${executableSuffix}`), args);
  }

  const archive = join(
    temporaryOutput,
    "bin",
    "wasm",
    "release",
    "stackchan-stage-client",
    "mc.xsa",
  );
  mkdirSync(dirname(target), { recursive: true });
  copyFileSync(archive, target);
  const digest = createHash("sha256")
    .update(readFileSync(target))
    .digest("hex");
  process.stdout.write(`Built ${target}\nSHA-256 ${digest}\n`);
} finally {
  rmSync(temporaryOutput, { recursive: true, force: true });
}
