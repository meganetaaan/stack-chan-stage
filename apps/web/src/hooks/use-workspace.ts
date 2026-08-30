import { useSyncExternalStore } from "react";

import type { WorkspaceStore } from "@stackchan-stage/application";

export const useWorkspace = (store: WorkspaceStore) =>
  useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
