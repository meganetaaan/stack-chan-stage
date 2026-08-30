export type StoredMod = Readonly<{
  name: string
  bytes: Uint8Array
  size: number
  installedAt: number
  storage: 'memory' | 'indexedDB'
}>

export type ModStorage = Readonly<{
  saveInstalledMod(mod: Readonly<{ name: string; bytes: Uint8Array }>): Promise<StoredMod>
  loadInstalledMod(): Promise<StoredMod | null>
  clearInstalledMod(): Promise<void>
}>

export function validateModArchive(bytes: ArrayBuffer | ArrayBufferView | Uint8Array): Uint8Array
export function createMemoryModStorage(): ModStorage
export function createModStorage(options?: Readonly<{
  indexedDB?: IDBFactory
  databaseName?: string
  storeName?: string
}>): ModStorage
export function formatByteSize(bytes: number): string
