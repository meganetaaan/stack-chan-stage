import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { asCueExecutionId } from "@stackchan-stage/domain";
import {
  MAX_CONTROL_MESSAGE_BYTES,
  MAX_OPUS_PACKET_BYTES,
  createExecutionRegistry,
  decodeControlMessage,
  decodeMediaMessage,
  validateOpusPacket,
} from "../src";

const fixture = (name: string) =>
  readFileSync(
    fileURLToPath(new URL(`../src/fixtures/${name}`, import.meta.url)),
    "utf8",
  );

describe("Protocol contract fixtures", () => {
  it.each([
    ["actor-hello.json", "actor.hello"],
    ["cue-execute.json", "cue.execute"],
  ])("%sをControl messageとして共有できる", (name, type) => {
    expect(decodeControlMessage(fixture(name))).toMatchObject({
      ok: true,
      value: { type },
    });
  });

  it("audio.open fixtureをMedia messageとして共有できる", () => {
    expect(decodeMediaMessage(fixture("audio-open.json"))).toMatchObject({
      ok: true,
      value: { type: "audio.open" },
    });
  });

  it("unknown field、fragment相当の不完全JSON、oversized messageをrejectする", () => {
    const hello = JSON.parse(fixture("actor-hello.json"));
    expect(
      decodeControlMessage(JSON.stringify({ ...hello, injected: true })).ok,
    ).toBe(false);
    expect(decodeControlMessage('{"type":"actor.hello"').ok).toBe(false);
    expect(
      decodeControlMessage("x".repeat(MAX_CONTROL_MESSAGE_BYTES + 1)),
    ).toMatchObject({
      ok: false,
      code: "message_too_large",
    });
  });

  it("Opus packetの空・oversizedをrejectする", () => {
    expect(validateOpusPacket(new Uint8Array([1, 2, 3])).ok).toBe(true);
    expect(validateOpusPacket(new Uint8Array()).ok).toBe(false);
    expect(
      validateOpusPacket(new Uint8Array(MAX_OPUS_PACKET_BYTES + 1)),
    ).toMatchObject({
      ok: false,
      code: "packet_too_large",
    });
  });
});

describe("Cue idempotency", () => {
  it("同じexecutionを再受付しても物理動作を二重開始しない", () => {
    const registry = createExecutionRegistry();
    const id = asCueExecutionId("execution-1");
    expect(registry.begin(id)).toEqual({ duplicate: false });
    expect(registry.begin(id)).toEqual({ duplicate: true });
    registry.settle(id, { status: "completed" });
    expect(registry.begin(id)).toEqual({
      duplicate: true,
      outcome: { status: "completed" },
    });
  });

  it("settled履歴を有界に保つ", () => {
    const registry = createExecutionRegistry(2);
    for (let index = 0; index < 10; index += 1) {
      const id = asCueExecutionId(`execution-${index}`);
      registry.begin(id);
      registry.settle(id, { status: "completed" });
    }
    expect(registry.size()).toBeLessThanOrEqual(2);
  });
});
