// Vendored from stack-chan/stack-chan at c6171cff5e79bb8ac8cf0ca4675a41a877481292.
// Modified by stack-chan-stage to type the Host.Stage injection point.
export type SimulatorStatusCode = 'wasm-loading' | 'wasm-load-failed' | 'firmware-ready-timeout' | 'firmware-ready'

export type SimulatorStatus = {
  status: 'pending' | 'success' | 'error'
  code: SimulatorStatusCode
}

export type SimulatorModResult = {
  status: 'empty' | 'saved' | 'prepared' | 'installed' | 'unsupported' | 'restarting' | 'error'
  name?: string
  size?: number
  error?: string
}

export type InstalledMod = {
  name: string
  size: number
  storage?: 'memory' | 'indexedDB'
}

export type StoredMod = InstalledMod & {
  bytes: Uint8Array
  installedAt?: number
}

export type SimulatorModStorage = {
  saveInstalledMod(mod: { name: string; bytes: Uint8Array }): Promise<StoredMod>
  loadInstalledMod(): Promise<StoredMod | null>
  clearInstalledMod(): Promise<void>
}

export type CameraStatus = {
  status: 'idle' | 'pending' | 'connected' | 'fallback' | 'error'
  error?: string
}

export type SimulatorReady = {
  runCount: number
  installationStatus: SimulatorModResult['status']
}

export type SimulatorHostStage = {
  subscribeCommand(listener: (command: unknown) => void): () => void
  emitEvent(event: unknown): void
  playAudio(streamId: string, onStarted?: () => void): Promise<void>
  abortAudio(reason?: string): Promise<void>
}

export class SimulatorEngine {
  constructor(options: {
    viewport: HTMLCanvasElement
    screen: HTMLCanvasElement
    runtimeBaseUrl?: string
    hostStage?: SimulatorHostStage
    modStorage?: SimulatorModStorage
    onStatus?: (status: SimulatorStatus) => void
    onTrace?: (message: string) => void
    onModStatus?: (result: SimulatorModResult, installedMod?: InstalledMod | null) => void
    onCameraStatus?: (status: CameraStatus) => void
    onReady?: (ready: SimulatorReady) => void
    onError?: (error: unknown) => void
  })
  start(): Promise<void>
  refreshModStatus(): Promise<InstalledMod | null>
  installMod(file: File): Promise<void>
  restart(): Promise<void>
  clearMod(): Promise<void>
  connectCamera(): Promise<void>
  pushButton(name: 'a' | 'b' | 'c'): void
  dispose(): void
}
