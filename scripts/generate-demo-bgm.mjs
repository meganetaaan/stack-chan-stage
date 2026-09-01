import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const SAMPLE_RATE = 24_000;
const DURATION_SECONDS = 12;
const TARGET_PEAK = 0.18;

const outputPath = resolve(
  process.argv[2] ?? "apps/web/public/demo/webmcp-night-loop.wav",
);

const tones = [
  { frequency: 110, amplitude: 1, modulationCycles: 1, phase: 0.15 },
  {
    frequency: 1570 / DURATION_SECONDS,
    amplitude: 0.72,
    modulationCycles: 2,
    phase: 0.55,
  },
  {
    frequency: 1978 / DURATION_SECONDS,
    amplitude: 0.58,
    modulationCycles: 3,
    phase: 1.05,
  },
  { frequency: 220, amplitude: 0.28, modulationCycles: 2, phase: 1.8 },
];

const sampleCount = SAMPLE_RATE * DURATION_SECONDS;
const samples = new Float64Array(sampleCount);
let peak = 0;

for (let index = 0; index < sampleCount; index += 1) {
  const time = index / SAMPLE_RATE;
  const loopPhase = (2 * Math.PI * time) / DURATION_SECONDS;
  const breathing = 0.72 + 0.18 * Math.sin(loopPhase - Math.PI / 2);
  let sample = 0;
  for (const tone of tones) {
    const modulation =
      0.82 + 0.18 * Math.sin(tone.modulationCycles * loopPhase + tone.phase);
    sample +=
      Math.sin(2 * Math.PI * tone.frequency * time) *
      tone.amplitude *
      modulation;
  }
  samples[index] = sample * breathing;
  peak = Math.max(peak, Math.abs(samples[index]));
}

const bytesPerSample = 2;
const dataBytes = sampleCount * bytesPerSample;
const output = Buffer.alloc(44 + dataBytes);
output.write("RIFF", 0);
output.writeUInt32LE(36 + dataBytes, 4);
output.write("WAVE", 8);
output.write("fmt ", 12);
output.writeUInt32LE(16, 16);
output.writeUInt16LE(1, 20);
output.writeUInt16LE(1, 22);
output.writeUInt32LE(SAMPLE_RATE, 24);
output.writeUInt32LE(SAMPLE_RATE * bytesPerSample, 28);
output.writeUInt16LE(bytesPerSample, 32);
output.writeUInt16LE(16, 34);
output.write("data", 36);
output.writeUInt32LE(dataBytes, 40);

const scale = peak === 0 ? 0 : TARGET_PEAK / peak;
for (let index = 0; index < sampleCount; index += 1) {
  const value = Math.max(-1, Math.min(1, samples[index] * scale));
  output.writeInt16LE(Math.round(value * 0x7fff), 44 + index * 2);
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, output);
process.stdout.write(
  `Generated ${outputPath} (${DURATION_SECONDS}s, ${SAMPLE_RATE} Hz, mono PCM16)\n`,
);
