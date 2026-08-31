# stack-chan simulator vendor record

- Upstream: <https://github.com/stack-chan/stack-chan>
- Commit: `c6171cff5e79bb8ac8cf0ca4675a41a877481292`
- License: Apache License 2.0 (see `LICENSE`)
- Vendored files:
  - `web/src/services/simulator/simulator-engine.mjs`
  - `web/src/services/simulator/simulator-engine.d.mts`
  - `web/simulator/bridge.mjs`
  - `web/simulator/geometry.mjs`
  - `web/simulator/mod-storage.mjs`
  - `web/simulator/mod-storage.d.mts`

`simulator-engine.mjs` and its declaration carry a local patch that injects a
caller-supplied bridge as `Host.Stage`. The remaining source files are copied
without modification.

The runtime assets under `apps/web/public/simulator` are built for this
repository. They are not byte-for-byte copies of the upstream published
runtime. `mc.js` and `mc.wasm` include the native `Host.Stage` bridge from
`firmware/modules/stage-wasm-host`; `stage-client.xsa` contains this
repository's Stage MOD.

| File | SHA-256 |
| --- | --- |
| `mc.js` | `1f50e6cb39ebdbe10557012726d59b2c7507080289db0f6faed6bded832761ee` |
| `mc.wasm` | `2cdbba042963a6359aef034ef82c4e2fe6b7c1abf3357c1e47ebc631a763f324` |
| `stage-client.xsa` | `5198e3b1838b81036799b49bc5de78a0dc1fc07373a6a2672094f74fe5e67fad` |
| `assets/case/v1/shell.stl` | `832ced3ad3669c3fc6b174a984cc800522ca33cecd9222d531bda430f6cc5236` |

The pinned build inputs are:

- stack-chan commit `c6171cff5e79bb8ac8cf0ca4675a41a877481292`
- Moddable SDK 9.0.0, commit `b1f42a2e148f0fc2cd91d7ed1cee56bd361656b2`
- Emscripten 5.0.1
- TypeScript 7.0.2 from the pinned stack-chan firmware lockfile
- `fontbm` on the build `PATH`

Rebuild the Stage MOD with:

```console
MODDABLE=/path/to/moddable npm run build:stage-mod
```

Rebuild the custom WASM host with:

```console
MODDABLE=/path/to/moddable \
STACKCHAN_STAGE_UPSTREAM=/path/to/stack-chan \
EMSDK=/path/to/emsdk \
npm run build:stage-wasm-host
```

Both scripts reject mismatched pinned versions. Run
`npm run check:simulator-assets` after rebuilding and update this record and
`scripts/verify-simulator-assets.mjs` only when the generated files are an
intentional change.
