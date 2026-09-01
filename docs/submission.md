# Stack-chan Stage — WebMCP submission draft

## Tagline

Co-direct a robot performance with an AI—through the page, not around it.

## Links

- Live demo: https://meganetaaan.github.io/stack-chan-stage/
- Public source: https://github.com/meganetaaan/stack-chan-stage
- License: Apache-2.0
- Demo asset provenance: https://github.com/meganetaaan/stack-chan-stage/blob/main/ATTRIBUTION.md

![Stack-chan Stage hero flow](https://raw.githubusercontent.com/meganetaaan/stack-chan-stage/main/docs/media/hero-flow.gif)

## What it does

Stack-chan Stage is a browser-native director console for robot theatre. A human
and an AI work in the same visible scenario: scenes, roles, dialogue, direction,
expressions, motions, backdrops, music, and cast assignments. The result can run
immediately on the bundled Stack-chan WASM simulator or, through a local gateway,
on a physical robot.

The contest demo opens with a ready-made three-scene performance. The agent reads
the workspace, revises the middle scene, validates all 13 cues, previews only the
edited range, waits for the human to approve it, and then plays the complete
show. The person never has to trust an invisible draft: each tool mutation lands
in the same timeline and stage monitor they are already viewing.

## Why WebMCP

A conventional browser agent must infer application structure from pixels and
simulate clicks. That is brittle for a stage editor: cue order, asset identity,
cast resolution, and revision conflicts are domain state, not visual styling.

Stack-chan Stage exposes 15 imperative WebMCP tools backed by the application's
real command layer. The agent receives structured scenario data and stable IDs,
then invokes typed operations for workspace retrieval, validation, scene and cue
editing, asset import, cast changes, preview, play, and stop. Every write requires
the expected workspace revision, so stale plans fail clearly instead of silently
overwriting a person's changes.

WebMCP is the product interaction, not a wrapper around a separate automation
service. Calls update the open page in place. That makes the agent fast and
precise while keeping the human in control of a consequential moment: starting
the full performance.

## Human-agent experience

The hero flow deliberately separates drafting from performance:

1. The agent reads the current workspace and revision.
2. It revises a bounded set of cues in the collaboration scene.
3. It validates the whole scenario and reports any issues.
4. It previews only the changed cue range.
5. The human watches the simulator and confirms the result.
6. Only then does the agent play all scenes.

The editor shows the active cue, revision number, WebMCP availability, runtime
state, and stage output throughout the flow. This shared surface lets the human
interrupt, edit, or stop without leaving the collaboration context.

## How it is built

The application is a TypeScript monorepo with a React/Vite web UI, a domain and
runtime core, browser and hardware adapters, IndexedDB persistence, and a
Moddable-based Stack-chan simulator. Zod schemas validate saved data, WebMCP
inputs, gateway messages, TTS responses, and simulator events at their adapter
boundaries.

The default performance includes three original AI-generated background images
with preserved source metadata and a deterministic, sample-free BGM loop. Asset
size, SHA-256 digest, content-derived ID, source path, and license are checked in
CI. Project ZIP export embeds the assets so a performance can be moved to another
browser without broken references.

Five Playwright E2E flows cover simulator pixels and lip sync, project ZIP
round-tripping, mobile interaction, timed pauses, and the complete WebMCP hero
flow from workspace retrieval through human-approved playback.

## How to try it

Open the live demo in a fresh or private WebMCP-capable browser window. Wait for
`WASM READY`, then click once so the browser permits audio. Send these prompts in
order.

```text
Read the current Stage workspace. In scene-collaboration, update the backdrop to Human-Agent Revision Loop with a slide from the left over 650 ms; set narrator to HAPPY; replace the speech with「WebMCPなら、AIがページの構造を読み、人と同じ舞台へ演出を書き戻せます。」; set its direction to「発見を観客と分かち合うように」; and change the motion to clap. Use expectedRevision correctly after every mutation. Do not preview or play yet.
```

```text
Validate the current scenario. Preview only scene-collaboration from cue-collaboration-backdrop through cue-collaboration-motion with audible speech. When the preview ends, summarize any warnings and ask for my confirmation. Do not start the full performance.
```

After reviewing the preview, reply:

```text
Looks good. Play all scenes with audible speech, then report the final run status.
```

## Challenges and lessons

The central implementation challenge was preserving one source of truth across
human edits, agent calls, persistence, preview, and runtime execution. Stable
IDs and optimistic revisions make that boundary explicit. A second challenge was
browser media behavior: source-backed assets are fetched and digest-checked on
demand, while the first user gesture resumes the audio context before WebMCP can
request playback.

The larger lesson is that human oversight works best when it is a normal product
state, not a disclaimer. A bounded preview, visible revision, and separate Play
operation give the person a meaningful checkpoint without taking structured
tools away from the agent.

## Known limitations

- IndexedDB persists the last project in a browser profile; use a fresh or
  private window to reproduce the bundled demo.
- Browser TTS voices and quality vary by platform, and audio requires an initial
  user gesture.
- Runtime execution is currently sequential within one lane per scene.
- The hosted demo uses the WASM simulator. Physical hardware requires a local
  gateway and Opus TTS endpoint and has not been exercised by automated tests.
- WebMCP remains experimental and depends on browser support or flags.
