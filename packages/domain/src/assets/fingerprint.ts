import { bytesToHex } from "@noble/hashes/utils.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { canonicalJson } from "../shared";
import type { AudioFormat } from "../casting/types";
import type { VoiceProfileRef } from "../scenario/types";

export type AudioFingerprintInput = Readonly<{
  text: string;
  direction?: string;
  voice: VoiceProfileRef;
  model?: string;
  format: AudioFormat;
}>;

export const createAudioFingerprint = (
  input: AudioFingerprintInput,
): string => {
  const bytes = new TextEncoder().encode(canonicalJson(input));
  return bytesToHex(sha256(bytes));
};
