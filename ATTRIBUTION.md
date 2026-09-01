# Demo asset attribution

This document records the source and distribution information for the four
assets bundled with the default WebMCP contest demo. Third-party runtime assets
are listed separately in [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).

## Background images

The three background images are original Stack-chan Stage assets generated with
OpenAI Media Service (ImageGen 2.0) on 2026-08-31. No third-party reference
images were supplied. The exact generation prompts were not retained, so this
record does not attempt to reconstruct them.

The source PNG files retain their Content Credentials metadata:

| Demo asset                | Preserved source                                                      | Published derivative                                              |
| ------------------------- | --------------------------------------------------------------------- | ----------------------------------------------------------------- |
| Open Web Constellation    | `assets/source/webmcp-demo/scene-01a-web-constellation.png`           | `apps/web/public/demo/scene-01a-web-constellation.webp`           |
| Human-Agent Revision Loop | `assets/source/webmcp-demo/scene-04b-collaborative-revision-loop.png` | `apps/web/public/demo/scene-04b-collaborative-revision-loop.webp` |
| Shared Toolbox Finale     | `assets/source/webmcp-demo/scene-05b-shared-toolbox-finale.png`       | `apps/web/public/demo/scene-05b-shared-toolbox-finale.webp`       |

The published files are 1600×900 WebP derivatives encoded with FFmpeg at
quality 82. They contain no additional source material.

## Background music

`WebMCP Night Loop` is an original, sample-free procedural composition generated
by [`scripts/generate-demo-bgm.mjs`](scripts/generate-demo-bgm.mjs). The script
synthesizes a deterministic 12-second loop as 24 kHz mono PCM16 WAV. It does not
load samples, sound fonts, or other external audio.

Published file:
`apps/web/public/demo/webmcp-night-loop.wav`

## License and integrity

The project distributes these original assets under the
[Apache License 2.0](LICENSE), to the extent copyright and licensing rights
apply. Their paths, byte sizes, SHA-256 digests, content-derived IDs, and license
labels are recorded in
[`apps/web/src/composition/demo-assets.json`](apps/web/src/composition/demo-assets.json)
and verified by `npm run check:demo-assets`.
