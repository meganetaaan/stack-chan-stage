import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { delimiter, dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";

const STACKCHAN_COMMIT = "c6171cff5e79bb8ac8cf0ca4675a41a877481292";
const MODDABLE_VERSION = "9.0.0";
const EMSCRIPTEN_VERSION = "5.0.1";
const TYPESCRIPT_VERSION = "7.0.2";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moddable = process.env.MODDABLE;
const upstream = process.env.STACKCHAN_STAGE_UPSTREAM;
if (!moddable)
  throw new Error("MODDABLE must point to a Moddable SDK checkout");
if (!upstream)
  throw new Error(
    "STACKCHAN_STAGE_UPSTREAM must point to the pinned stack-chan checkout",
  );

const hostPlatform =
  process.platform === "darwin"
    ? "mac"
    : process.platform === "win32"
      ? "win"
      : "lin";
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const commandSuffix = process.platform === "win32" ? ".cmd" : "";
const toolDirectory =
  process.env.MODDABLE_TOOLS ??
  join(moddable, "build", "bin", hostPlatform, "release");
const upstreamFirmware = join(upstream, "firmware");
const upstreamCommands = join(upstreamFirmware, "node_modules", ".bin");
const emsdk = process.env.EMSDK;
const environment = {
  ...process.env,
  MODDABLE: moddable,
  ...(emsdk && !process.env.EM_CONFIG
    ? { EM_CONFIG: join(emsdk, ".emscripten") }
    : {}),
  PATH: [
    upstreamCommands,
    toolDirectory,
    ...(emsdk ? [join(emsdk, "upstream", "emscripten")] : []),
    process.env.PATH ?? "",
  ].join(delimiter),
};

const capture = (command, args, cwd = repositoryRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} exited with status ${result.status}: ${result.stderr.trim()}`,
    );
  return result.stdout.trim();
};

const run = (command, args, cwd = repositoryRoot) => {
  const result = spawnSync(command, args, {
    cwd,
    env: environment,
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} exited with status ${result.status}`);
};

const requireVersion = (label, actual, expected) => {
  if (actual !== expected)
    throw new Error(`${label} ${expected} is required (found ${actual})`);
};

requireVersion(
  "stack-chan commit",
  capture("git", ["rev-parse", "HEAD"], upstream),
  STACKCHAN_COMMIT,
);
requireVersion(
  "Moddable SDK",
  readFileSync(join(moddable, "tools", "VERSION"), "utf8").trim(),
  MODDABLE_VERSION,
);
const tsc = join(upstreamCommands, `tsc${commandSuffix}`);
if (!existsSync(tsc))
  throw new Error(
    `Run npm ci --ignore-scripts in ${upstreamFirmware} before building`,
  );
requireVersion(
  "TypeScript",
  capture(tsc, ["--version"]).replace(/^Version\s+/, ""),
  TYPESCRIPT_VERSION,
);
const emccVersion = capture("emcc", ["--version"]).split("\n")[0] ?? "";
if (!emccVersion.includes(` ${EMSCRIPTEN_VERSION} `))
  throw new Error(
    `Emscripten ${EMSCRIPTEN_VERSION} is required (found ${emccVersion})`,
  );
const fontbm =
  process.env.FONTBM ??
  capture(process.platform === "win32" ? "where" : "which", ["fontbm"]);

const temporaryOutput = mkdtempSync(
  join(tmpdir(), "stackchan-stage-wasm-host-"),
);
const wrapperManifest = join(
  upstreamFirmware,
  "host",
  "app",
  `.manifest-stackchan-stage-${process.pid}.json`,
);
const stageHostManifest = join(
  repositoryRoot,
  "firmware",
  "wasm-host",
  "manifest.json",
);
const runtimePreJs = join(
  upstreamFirmware,
  "host",
  "platforms",
  "wasm",
  "browser-runtime.pre.js",
);
const buildDirectory = join(
  temporaryOutput,
  "tmp",
  "wasm",
  "debug",
  "stack-chan-host",
);
const binaryDirectory = join(
  temporaryOutput,
  "bin",
  "wasm",
  "debug",
  "stack-chan-host",
);
const targetDirectory = join(
  repositoryRoot,
  "apps",
  "web",
  "public",
  "simulator",
);
const linkOptions = [
  "-s ENVIRONMENT=web",
  "-s ALLOW_MEMORY_GROWTH=1",
  "-s MODULARIZE=1",
  "-s EXPORT_ES6=1",
  "-s EXPORT_NAME=mc",
  "-s INVOKE_RUN=0",
  "-s FORCE_FILESYSTEM=1",
  `--pre-js ${runtimePreJs}`,
  "-sEXPORTED_FUNCTIONS=_fxMainIdle,_fxMainLaunch,_fxMainQuit,_fxMainTouch,_malloc,_free",
  "-sEXPORTED_RUNTIME_METHODS=HEAP8,HEAPU8",
].join(" ");

try {
  writeFileSync(
    wrapperManifest,
    `${JSON.stringify(
      {
        include: ["./manifest_wasm.json", stageHostManifest],
      },
      null,
      2,
    )}\n`,
    { flag: "wx" },
  );
  run(
    join(toolDirectory, `mcconfig${executableSuffix}`),
    ["-d", "-p", "wasm", "-t", "build", "-o", temporaryOutput, wrapperManifest],
    upstreamFirmware,
  );
  run(process.env.MAKE ?? "make", [
    "-C",
    buildDirectory,
    "-f",
    "makefile",
    `LINK_OPTIONS=${linkOptions}`,
    `FONTBM=${fontbm}`,
  ]);

  mkdirSync(targetDirectory, { recursive: true });
  for (const name of ["mc.js", "mc.wasm"]) {
    const source = join(binaryDirectory, name);
    const target = join(targetDirectory, name);
    copyFileSync(source, target);
    const digest = createHash("sha256")
      .update(readFileSync(target))
      .digest("hex");
    process.stdout.write(`Built ${target}\nSHA-256 ${digest}\n`);
  }
} finally {
  if (existsSync(wrapperManifest)) unlinkSync(wrapperManifest);
  rmSync(temporaryOutput, { recursive: true, force: true });
}
