import type {
  PreparedAudio,
  ProjectSnapshot,
  ProjectStorePort,
} from "@stackchan-stage/application";
import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export const DEFAULT_STAGE_DATABASE = "stackchan-stage";

type StoredAudio = PreparedAudio & Readonly<{ lastUsed: number }>;

interface StageDatabase extends DBSchema {
  project: {
    key: "current";
    value: ProjectSnapshot;
  };
  blobs: {
    key: string;
    value: Blob;
  };
  audio: {
    key: string;
    value: StoredAudio;
    indexes: { "by-last-used": number };
  };
}

const openStageDatabase = (
  name: string,
): Promise<IDBPDatabase<StageDatabase>> =>
  openDB<StageDatabase>(name, 1, {
    upgrade(database) {
      if (!database.objectStoreNames.contains("project"))
        database.createObjectStore("project");
      if (!database.objectStoreNames.contains("blobs"))
        database.createObjectStore("blobs");
      if (!database.objectStoreNames.contains("audio")) {
        const audio = database.createObjectStore("audio", {
          keyPath: "fingerprint",
        });
        audio.createIndex("by-last-used", "lastUsed");
      }
    },
  });

export type IndexedDbProjectStore = ProjectStorePort &
  Readonly<{ close: () => Promise<void> }>;

export const createIndexedDbProjectStore = (
  databaseName = DEFAULT_STAGE_DATABASE,
): IndexedDbProjectStore => {
  const database = openStageDatabase(databaseName);
  return {
    async load() {
      return (await database).get("project", "current");
    },
    async save(snapshot) {
      await (await database).put("project", snapshot, "current");
    },
    async saveBlob(assetId, blob) {
      await (await database).put("blobs", blob, assetId);
    },
    async loadBlob(assetId) {
      return (await database).get("blobs", assetId);
    },
    async close() {
      (await database).close();
    },
  };
};

export type IndexedDbAudioCache = Readonly<{
  get: (fingerprint: string) => Promise<PreparedAudio | undefined>;
  put: (audio: PreparedAudio) => Promise<void>;
  delete: (assetId: string) => Promise<void>;
  entries: () => Promise<readonly StoredAudio[]>;
  close: () => Promise<void>;
}>;

export const createIndexedDbAudioCache = ({
  databaseName = DEFAULT_STAGE_DATABASE,
  maximumBytes = 12 * 1024 * 1024,
  maximumEntries = 3,
  now = () => Date.now(),
}: Readonly<{
  databaseName?: string;
  maximumBytes?: number;
  maximumEntries?: number;
  now?: () => number;
}> = {}): IndexedDbAudioCache => {
  const database = openStageDatabase(databaseName);

  const evict = async () => {
    const db = await database;
    const values = await db.getAllFromIndex("audio", "by-last-used");
    let bytes = values.reduce((sum, entry) => sum + entry.byteSize, 0);
    let count = values.length;
    const transaction = db.transaction("audio", "readwrite");
    for (const entry of values) {
      if (count <= maximumEntries && bytes <= maximumBytes) break;
      await transaction.store.delete(entry.fingerprint);
      count -= 1;
      bytes -= entry.byteSize;
    }
    await transaction.done;
  };

  return {
    async get(fingerprint) {
      const db = await database;
      const entry = await db.get("audio", fingerprint);
      if (!entry) return undefined;
      const refreshed: StoredAudio = { ...entry, lastUsed: now() };
      await db.put("audio", refreshed);
      const { lastUsed: _lastUsed, ...audio } = refreshed;
      return audio;
    },
    async put(audio) {
      await (await database).put("audio", { ...audio, lastUsed: now() });
      await evict();
    },
    async delete(assetId) {
      const db = await database;
      const transaction = db.transaction("audio", "readwrite");
      let cursor = await transaction.store.openCursor();
      while (cursor) {
        if (cursor.value.id === assetId) await cursor.delete();
        cursor = await cursor.continue();
      }
      await transaction.done;
    },
    async entries() {
      return (await database).getAllFromIndex("audio", "by-last-used");
    },
    async close() {
      (await database).close();
    },
  };
};
